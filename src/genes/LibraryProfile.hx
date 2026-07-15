package genes;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
import genes.PublicSurface.PublicMember;

using haxe.macro.TypeTools;

/**
 * Walks the target-neutral Haxe declarations named by a public API type.
 *
 * Why: `TypeReferenceCollector` deliberately models a target type projection;
 * for example, TS literal unions and classic-erased abstracts can take different
 * branches. Library runtime retention must be identical before either printer
 * chooses syntax.
 *
 * What/How: this deliberately small walker follows function, anonymous,
 * typedef, abstract, generic-argument, and constraint structure. It reports
 * only non-extern concrete classes, enums, and typedefs that can contribute to
 * the reusable source graph. Core/extern types remain the normal compiler or
 * host runtime's responsibility. A recursion stack handles recursive aliases
 * without converting types to target text.
 */
private class LibraryTypeGraph {
  final includeType: ModuleType->Void;
  final stack = new Map<String, Bool>();

  public function new(includeType: ModuleType->Void) {
    this.includeType = includeType;
  }

  public function collectParameters(parameters: Array<TypeParameter>): Void {
    for (parameter in parameters) {
      collect(parameter.t);
      switch parameter.t {
        case TInst(_.get() => {kind: KTypeParameter(constraints)}, _):
          for (constraint in constraints)
            collect(constraint);
        default:
      }
    }
  }

  public function collectMany(types: Array<Type>): Void {
    for (type in types)
      collect(type);
  }

  public function collect(type: Type): Void {
    if (type == null)
      return;
    final key = type.toString();
    if (stack.exists(key))
      return;
    stack.set(key, true);
    collectInner(type);
    stack.remove(key);
  }

  function collectInner(type: Type): Void {
    switch type {
      case TMono(ref):
        final resolved = ref.get();
        if (resolved != null)
          collect(resolved);

      case TEnum(ref = _.get() => enumType, parameters):
        if (!enumType.isExtern)
          includeType(TEnumDecl(ref));
        collectMany(parameters);

      case TInst(ref = _.get() => cl, parameters):
        switch cl.kind {
          case KTypeParameter(constraints):
            collectMany(constraints);
          case KAbstractImpl(_):
            // Abstract implementation classes are storage details. Their
            // methods are retained through kept method bodies, not published.
          default:
            if (!cl.isExtern && cl.module != 'StdTypes'
              && !cl.meta.has(':coreType'))
              includeType(TClassDecl(ref));
        }
        collectMany(parameters);

      case TType(ref = _.get() => definition, parameters):
        includeType(TTypeDecl(ref));
        collectMany(parameters);

      case TFun(arguments, result):
        for (argument in arguments)
          collect(argument.t);
        collect(result);

      case TAnonymous(_.get() => anonymous):
        for (field in anonymous.fields) {
          collectParameters(field.params);
          collect(field.type);
        }

      case TDynamic(inner) if (inner != null):
        collect(inner);

      case TLazy(resolve):
        collect(resolve());

      case TAbstract(ref = _.get() => abstractType, parameters):
        collectMany(parameters);
        if (!abstractType.meta.has(':coreType'))
          collect(abstractType.type.applyTypeParameters(
            abstractType.params, parameters));

      case TDynamic(_):
    }
  }
}

/**
 * Plans the opt-in reusable-library runtime surface before Haxe DCE runs.
 *
 * Why: application DCE is allowed to erase public methods that no Haxe code
 * calls. That is correct for an application, but a reusable JavaScript library
 * is called by code outside the Haxe compilation. Emitting a wider `.d.ts`
 * after DCE would be dishonest because consumers could call methods absent from
 * the JavaScript file.
 *
 * What: `-D genes.library` activates `@:genes.library` roots. Each selected
 * class retains its complete public runtime surface and recursively retains
 * concrete Haxe declarations named by that surface. Classic mode requires
 * `-D dts`, making executable JavaScript and declarations one profile contract;
 * TypeScript mode already carries its declaration surface in the implementation
 * source. Without the define, the metadata is inert and normal compact DCE is
 * unchanged.
 *
 * How: `PublicSurface` first snapshots source declarations. This pass then adds
 * `@:keep` to the corresponding compiler-owned fields before DCE and traverses
 * their typed signatures with the target-neutral `LibraryTypeGraph`. Method
 * bodies remain Haxe DCE's responsibility, so private helpers are retained only
 * when a kept public method actually calls them. Typedefs and interfaces
 * participate in the type graph; abstracts continue to erase through their
 * backing types. The generator separately turns only marked roots into
 * package-level ESM exports.
 */
class LibraryProfile {
  public static inline final DEFINE = 'genes.library';
  public static inline final METADATA = ':genes.library';

  /** Returns whether reusable-library retention is active for this build. */
  public static inline function isEnabled(): Bool {
    return Context.defined(DEFINE);
  }

  /**
   * Rejects a classic profile that could promise no matched type surface.
   *
   * Validation runs while the generator is installed, before any output writer
   * opens. A failed profile therefore cannot leave a partially updated tree.
   */
  public static function validate(): Void {
    if (isEnabled() && !Context.defined('genes.ts')
      && !Context.defined('dts')) {
      Context.error('-D genes.library requires -D dts in classic output: '
        + 'the reusable-library profile guarantees matched JavaScript and '
        + 'declaration surfaces', Context.currentPos());
    }
  }

  /** Returns whether a base type is an active package-level library root. */
  public static function isRoot(base: BaseType): Bool {
    return isEnabled() && base.meta.has(METADATA);
  }

  static function keepMeta(meta: MetaAccess, pos: Position): Void {
    if (!meta.has(':keep'))
      meta.add(':keep', [], pos);
  }

  static function keepField(field: ClassField): Void {
    keepMeta(field.meta, field.pos);
  }

  static function findField(fields: Array<ClassField>,
      name: String): Null<ClassField> {
    for (field in fields)
      if (field.name == name)
        return field;
    return null;
  }

  /**
   * Retains one captured member and compiler-generated property accessors.
   *
   * Public properties may be represented by a public field plus private
   * `get_`/`set_` methods. Those accessors are runtime implementation details,
   * so they are kept but never added to the consumer-facing `PublicSurface`.
   */
  static function retainMember(cl: ClassType, member: PublicMember): Bool {
    if (member.isConstructor) {
      if (cl.constructor != null) {
        keepField(cl.constructor.get());
        return true;
      }
      return false;
    }

    final ownerFields = member.isStatic ? cl.statics.get() : cl.fields.get();
    final field = findField(ownerFields, member.name);
    if (field != null)
      keepField(field);

    switch member.kind {
      case FVar(read, write):
        if (read.match(AccCall)) {
          final getter = findField(ownerFields, 'get_${member.name}');
          if (getter != null)
            keepField(getter);
        }
        if (write.match(AccCall)) {
          final setter = findField(ownerFields, 'set_${member.name}');
          if (setter != null)
            keepField(setter);
        }
      case FMethod(_):
    }
    return field != null;
  }

  /** Adds every named type from a public member signature to the work queue. */
  static function collectMember(member: PublicMember,
      collector: LibraryTypeGraph): Void {
    collector.collectParameters(member.copyParameters());
    collector.collect(member.type);
    for (signature in member.overloads)
      collectMember(signature, collector);
  }

  /**
   * Retains the transitive public graph rooted at `@:genes.library` classes.
   *
   * The input is the complete after-typing declaration inventory supplied by
   * Haxe. Processing uses stable FIFO order with declaration-identity
   * de-duplication, so adding target printers cannot alter retention order.
   */
  public static function retain(types: Array<ModuleType>): Void {
    if (!isEnabled())
      return;

    final pending: Array<ModuleType> = [];
    final seen = new Map<String, Bool>();
    function enqueue(type: ModuleType): Void {
      final key = DependencyPlan.moduleTypeKey(type);
      if (seen.exists(key))
        return;
      seen.set(key, true);
      pending.push(type);
    }

    for (type in types) {
      final base = DependencyPlan.moduleTypeBase(type);
      for (entry in base.meta.extract(METADATA)) {
        if (entry.params.length > 0)
          Context.error('@:genes.library does not accept arguments', entry.pos);
      }
    }

    final roots = [
      for (type in types)
        switch type {
          case TClassDecl(ref) if (ref.get().meta.has(METADATA)):
            type;
          case TEnumDecl(ref) if (ref.get().meta.has(METADATA)):
            Context.error('@:genes.library currently selects classes; '
              + 'export an enum through a marked library facade instead',
              ref.get().pos);
            continue;
          case TTypeDecl(ref) if (ref.get().meta.has(METADATA)):
            Context.error('@:genes.library cannot select an erased typedef; '
              + 'export it through a marked concrete library facade instead',
              ref.get().pos);
            continue;
          case TAbstract(ref) if (ref.get().meta.has(METADATA)):
            Context.error('@:genes.library cannot select an erased abstract; '
              + 'export it through a marked concrete library facade instead',
              ref.get().pos);
            continue;
          default:
            continue;
        }
    ];
    roots.sort((left, right) -> Reflect.compare(
      DependencyPlan.moduleTypeKey(left),
      DependencyPlan.moduleTypeKey(right)));
    if (roots.length == 0) {
      Context.error('-D genes.library found no typed @:genes.library class; '
        + 'mark a public facade and include otherwise-unreferenced API modules '
        + "with --macro include('my.library')", Context.currentPos());
    }
    for (root in roots)
      enqueue(root);

    final collector = new LibraryTypeGraph(enqueue);
    var index = 0;
    while (index < pending.length) {
      switch pending[index++] {
        case TClassDecl(ref):
          final cl = ref.get();
          if (cl.isExtern || cl.kind.match(KTypeParameter(_)))
            continue;

          final surface = PublicSurface.forClass(cl);
          var retainedRuntimeMember = false;
          final constructor = surface.constructorFor(
            cl.params.map(parameter -> parameter.t));
          if (constructor != null) {
            retainedRuntimeMember = retainMember(cl, constructor)
              || retainedRuntimeMember;
            collectMember(constructor, collector);
          }
          for (member in surface.declaredInstanceMembers) {
            retainedRuntimeMember = retainMember(cl, member)
              || retainedRuntimeMember;
            collectMember(member, collector);
          }
          for (member in surface.declaredStaticMembers) {
            retainedRuntimeMember = retainMember(cl, member)
              || retainedRuntimeMember;
            collectMember(member, collector);
          }

          collector.collectParameters(cl.params);
          switch surface.superClass {
            case null:
            case parent:
              enqueue(TClassDecl(parent.type));
              collector.collectMany(parent.copyArguments());
          }
          for (parent in surface.declaredInterfaces) {
            enqueue(TClassDecl(parent.type));
            collector.collectMany(parent.copyArguments());
          }

          // Interfaces erase, and a concrete class may intentionally expose
          // identity without declaring any public field. In those cases only,
          // a type-level keep is required to preserve the runtime declaration.
          if (!retainedRuntimeMember)
            keepMeta(cl.meta, cl.pos);

        case TTypeDecl(ref):
          final definition = ref.get();
          final surface = PublicSurface.forTypedef(definition);
          collector.collectParameters(definition.params);
          collector.collect(surface.aliasTypeFor(
            definition.params.map(parameter -> parameter.t)));

        case TEnumDecl(ref):
          final enumType = ref.get();
          if (!enumType.isExtern)
            keepMeta(enumType.meta, enumType.pos);
          collector.collectParameters(enumType.params);
          for (constructor in enumType.constructs)
            collector.collect(constructor.type);

        case TAbstract(ref):
          final abstractType = ref.get();
          collector.collect(TAbstract(ref,
            abstractType.params.map(parameter -> parameter.t)));
      }
    }
  }
}
#end
