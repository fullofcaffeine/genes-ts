package genes;

import haxe.macro.Context;
import haxe.macro.Type;
import haxe.macro.Expr;
import helder.Set;
import genes.util.TypeUtil;
import genes.Dependencies;
import genes.DependencyPlan.DependencyEdgeKind;
import genes.DependencyPlan.DependencyProjection;
import genes.util.Timer.timer;
import genes.TypeAccessor;
import genes.PublicSurface.PublicMember;
import genes.PublicSurface.PublicMemberOwnership;

using StringTools;
using haxe.macro.TypedExprTools;

enum FieldKind {
  Constructor;
  Method;
  Property;
}

typedef Field = {
  final kind: FieldKind;
  final methodKind: Null<MethodKind>;
  final meta: Null<MetaAccess>;
  final name: String;
  final type: Type;
  final expr: TypedExpr;
  final pos: Position;
  final isStatic: Bool;
  #if (haxe_ver >= 4.2)
  final isAbstract: Bool;
  #end
  final isPublic: Bool;
  final params: Array<TypeParameter>;
  final doc: Null<String>;
  final setter: Bool;
  final getter: Bool;
  final tsType: Null<String>;
  final overloads: Array<Field>;
}

enum Member {
  MClass(type: ClassType, params: Array<Type>, fields: Array<Field>);
  MEnum(type: EnumType, params: Array<Type>);
  MType(type: DefType, params: Array<Type>);
  MMain(expr: TypedExpr);
}

/**
 * Projects one typed top-level member onto independent output capabilities.
 *
 * Why: compiler ownership answers more questions than Haxe's `isPrivate`
 * flag. A `@:genes.compilerInternal` enum must survive typing and DCE without
 * becoming a public export, declaration, registry entry, or invented
 * source-map location. One visibility boolean cannot preserve that contract.
 *
 * What: the five facts describe implementation presence, ESM visibility,
 * consumer declaration visibility, Haxe reflection registration, and source
 * provenance separately. They are semantic output facts shared by classic JS,
 * genes-ts, and classic `.d.ts`; printers do not rediscover metadata policy.
 *
 * How: `Module.memberProjection` computes this immutable record from the typed
 * `BaseType`. Emitters apply it only at their final member boundary, after
 * dependency planning and Haxe DCE have consumed the complete typed member.
 */
typedef MemberProjection = {
  final emitImplementation:Bool;
  final exportImplementation:Bool;
  final emitDeclaration:Bool;
  final registerRuntimeType:Bool;
  final emitSourcePosition:Bool;
}

typedef ModuleContext = {
  modules: Map<String, Module>,
  concrete: Array<String>
}

typedef ModuleExport = {
  pos: Position,
  name: String,
  module: String,
  isType: Bool
}

class Module {
  public final module: String;
  public final path: String;
  public final members: Array<Member> = [];
  public final expose: Array<ModuleExport> = [];
  public final directivePlan: ModuleDirectivePlan;
  public var jsxPlan(get, null): JsxPlan;
  public var templateLiteralPlan(get, null): TemplateLiteralPlan;
  public var tsNarrowingPlan(get, null): genes.ts.TsNarrowingPlan;
  public var dependencyPlan(get, null): DependencyPlan;
  public var typeDependencies(get, null): Dependencies;
  public var declarationDependencies(get, null): Dependencies;
  public var codeDependencies(get, null): Dependencies;
  public var runtimeProjection(get, null): DependencyProjection;
  public var implementationProjection(get, null): DependencyProjection;
  public var tempPlan(get, null): TempPlan;
  public var moduleFunctionPlan(get, null): ModuleFunctionPlan;

  final context: ModuleContext;
  final cycleCache = new Map<String, Bool>();
  final namePlans = new Map<String, NamePlan>();

  public function new(context: ModuleContext, module, types: Array<Type>,
      ?main: TypedExpr, ?expose: Array<ModuleExport>) {
    this.context = context;
    this.module = module;
    directivePlan = ModuleDirectivePlan.forModule(module);
    if (expose != null)
      this.expose = expose;
    path = module.split('.').join('/');
    final endTimer = timer('members');
    addTypes(types);
    if (main != null)
      members.push(MMain(main));
    endTimer();
  }

  function get_dependencyPlan(): DependencyPlan {
    if (dependencyPlan == null)
      dependencyPlan = DependencyPlanBuilder.build(this);
    return dependencyPlan;
  }

  function get_jsxPlan(): JsxPlan {
    if (jsxPlan == null)
      jsxPlan = JsxPlan.build(this);
    return jsxPlan;
  }

  function get_templateLiteralPlan(): TemplateLiteralPlan {
    if (templateLiteralPlan == null)
      templateLiteralPlan = TemplateLiteralPlan.build(this);
    return templateLiteralPlan;
  }

  /**
   * Returns the function-local null/map facts consumed only by TypeScript.
   *
   * Classic JavaScript does not need TypeScript's non-null assertions, so this
   * plan remains lazy and target-specific. Haxe's typed expressions stay the
   * source of truth; the plan only records when an already typed value can be
   * printed without a defensive TypeScript assertion or null normalization.
   */
  function get_tsNarrowingPlan(): genes.ts.TsNarrowingPlan {
    if (tsNarrowingPlan == null)
      tsNarrowingPlan = genes.ts.TsNarrowingPlan.build(this);
    return tsNarrowingPlan;
  }

  /** Returns the shared target-neutral temporary plan for this module. */
  function get_tempPlan():TempPlan {
    if (tempPlan == null)
      tempPlan = TempPlan.build(this);
    return tempPlan;
  }

  /** Returns one cached naming projection used by planning and printing. */
  public function namePlan(profile:NamePlan.NamePlanProfile,
      jsxEmitTsx = false):NamePlan {
    final key = Std.string(profile) + ':' + (jsxEmitTsx ? 'tsx' : 'plain');
    if (!namePlans.exists(key))
      namePlans.set(key, NamePlan.build(this, tempPlan, profile,
        jsxEmitTsx));
    return namePlans.get(key);
  }

  /** Validates and returns the opt-in module-function lowering plan. */
  function get_moduleFunctionPlan():ModuleFunctionPlan {
    if (moduleFunctionPlan == null)
      moduleFunctionPlan = ModuleFunctionPlan.build(this);
    return moduleFunctionPlan;
  }

  /**
   * Adds declarations reached after Haxe's runtime-oriented DCE.
   *
   * Why: TS annotations and `.d.ts` surfaces can name types absent from
   * `JSGenApi.types`. The dependency graph retains their compiler refs, so the
   * generator can materialize them without reparsing an import string through
   * `Context.getType`.
   *
   * What/How: declarations are deduplicated by emitted member identity and use
   * the same member construction as initial runtime types. Any cached graph or
   * import projection is invalidated. Callers emit implementation files before
   * declaration-only expansion, preserving classic JS DCE.
   */
  public function addTypes(types: Array<Type>): Bool {
    var changed = false;
    for (type in types) {
      final base = TypeUtil.typeToBaseType(type);
      if (base != null && (getMember(base.name) != null
        || getMember(TypeUtil.baseTypeName(base)) != null))
        continue;
      switch type {
        case TEnum(_.get() => enumType, params):
          final name = TypeUtil.baseTypeFullName(enumType);
          if (context.concrete.indexOf(name) == -1)
            context.concrete.push(name);
          members.push(MEnum(enumType, params));
          changed = true;
        case TInst(_.get() => classType, params):
          final name = TypeUtil.baseTypeFullName(classType);
          if (context.concrete.indexOf(name) == -1)
            context.concrete.push(name);
          members.push(MClass(classType, params, fieldsOf(classType)));
          changed = true;
        case TType(_.get() => definition, params):
          function addIfConcrete(concreteType: BaseType): Void {
            final name = TypeUtil.baseTypeFullName(concreteType);
            if (context.concrete.indexOf(name) > -1) {
              members.push(MType(definition, params));
              changed = true;
            }
          }
          switch Context.followWithAbstracts(definition.type) {
            case TEnum(_.get() => followed, _):
              addIfConcrete(followed);
            case TInst(ref = _.get() => {
              kind: KNormal
              #if (haxe_ver >= 4.2)
              | KModuleFields(_)
              #end
              | KGeneric | KGenericInstance(_, _) | KAbstractImpl(_)
            }, _):
              addIfConcrete(ref.get());
            default:
              members.push(MType(definition, params));
              changed = true;
          }
        default:
          throw 'DependencyPlan attempted to materialize a non-module type';
      }
    }
    if (changed) {
      jsxPlan = null;
      tsNarrowingPlan = null;
      dependencyPlan = null;
      typeDependencies = null;
      declarationDependencies = null;
      codeDependencies = null;
      runtimeProjection = null;
      implementationProjection = null;
      tempPlan = null;
      moduleFunctionPlan = null;
      namePlans.clear();
      cycleCache.clear();
    }
    return changed;
  }

  public function toPath(from: String) {
    return genes.util.PathUtil.relative(path, from.replace('.', '/'));
  }

  public function isCyclic(test: String)
    return switch cycleCache.get(test) {
      case null:
        final endTimer = timer('isCyclic');
        final seen = new Set();
        seen.add(module);
        final res = testCycles(test, seen);
        cycleCache.set(test, res);
        endTimer();
        res;
      case v: v;
    }

  function testCycles(test: String, seen: Set<String>) {
    seen.add(test);
    switch context.modules[test] {
      case null:
        return false;
      case v:
        for (requestPlan in v.runtimeProjection.runtimeRequests) {
          final request = requestPlan.request;
          if (request.external)
            continue;
          final dependency = request.path;
          if (seen.exists(dependency)) {
            if (dependency == module)
              return true;
            else
              continue;
          }
          if (testCycles(dependency, seen))
            return true;
        }
        return false;
    }
  }

  function get_typeDependencies(): Dependencies {
    if (typeDependencies == null)
      typeDependencies = dependencyPlan.dependencies(this, [TypeOnly]);
    return typeDependencies;
  }

  function get_declarationDependencies(): Dependencies {
    if (declarationDependencies == null)
      declarationDependencies = dependencyPlan.dependencies(this,
        [DeclarationOnly]);
    return declarationDependencies;
  }

  function get_codeDependencies(): Dependencies {
    if (codeDependencies == null)
      codeDependencies = runtimeProjection.bindings;
    return codeDependencies;
  }

  /** Runtime-only ordered requests shared by cycle analysis and classic ESM. */
  function get_runtimeProjection(): DependencyProjection {
    if (runtimeProjection == null)
      runtimeProjection = dependencyPlan.projectImplementation(this, false);
    return runtimeProjection;
  }

  /** Runtime plus erasing TS-only bindings from one canonical alias allocator. */
  function get_implementationProjection(): DependencyProjection {
    if (implementationProjection == null)
      implementationProjection = dependencyPlan.projectImplementation(this,
        Context.defined('genes.ts'));
    return implementationProjection;
  }

  public function getMember(name: String) {
    for (member in members)
      switch member {
        case MClass({name: n}, _) | MEnum({name: n}, _) | MType({name: n}, _)
          if (n == name):
          return member;
        default:
      }
    return null;
  }

  /**
   * Returns the shared implementation/declaration projection for one member.
   *
   * Compiler-internal metadata hides every public/provenance surface while
   * retaining a local implementation so typed local uses still work. A
   * compiler-internal typedef is omitted only when it also declares
   * `@:genes.semanticOnly`, which means no emitted code may name that alias.
   * Ordinary members retain the existing projection.
   * Some libraries expose signatures through source-private helper types, so
   * changing Haxe privacy here would require a separate public-type
   * accessibility normalization rather than a printer flag.
   */
  public static function memberProjection(member:Member):MemberProjection {
    final base:Null<BaseType> = switch member {
      case MClass(type, _, _): type;
      case MEnum(type, _): type;
      case MType(type, _): type;
      case MMain(_): null;
    }
    if (base == null) {
      return {
        emitImplementation: true,
        exportImplementation: false,
        emitDeclaration: false,
        registerRuntimeType: false,
        emitSourcePosition: true
      };
    }
    final compilerInternal = CompilerInternal.isType(base.meta);
    final semanticOnlyType = compilerInternal
      && CompilerInternal.isSemanticOnlyType(base.meta)
      && member.match(MType(_, _));
    return {
      emitImplementation: !semanticOnlyType,
      exportImplementation: !compilerInternal,
      emitDeclaration: !compilerInternal,
      registerRuntimeType: !compilerInternal,
      emitSourcePosition: !compilerInternal
    };
  }

  /**
   * Projects semantic fields to the implementation/declaration output surface.
   *
   * Why: `@:genes.compilerInternal` carriers must survive Haxe typing and DCE so
   * `DependencyPlanBuilder` can inspect their expressions, but emitting them
   * would create a fake runtime/public value. Filtering inside `fieldsOf` would
   * be too early because that is also the semantic inventory.
   *
   * What/How: return a stable copy without compiler-internal fields. Both
   * implementation emitters and the declaration emitter call this at the last
   * shared field boundary, after dependency planning has consumed the original
   * ordered array.
   */
  public static function emittableFields(fields:Array<Field>):Array<Field> {
    return fields.filter(field -> !CompilerInternal.isField(field.meta));
  }

  static function hasExternSuper(s: ClassType)
    return switch s.superClass {
      case null: s.isExtern;
      case {t: _.get() => v}: hasExternSuper(v);
    }

  /**
   * Builds the emitter-facing field records for a typed class.
   *
   * With no surface, runtime emitters receive Haxe's post-DCE fields. Passing a
   * `PublicSurface` instead maps its pre-DCE, public-only members (including
   * overload identity) into the existing emitter record without coupling the
   * semantic model to target formatting. `retainedFields` constrains class
   * declarations to members present in emitted JS, while interfaces deliberately
   * remain complete because they erase at runtime. DependencyPlan independently
   * retains every type named by those surfaces without broadening classic JS.
   */
  public static function fieldsOf(cl: ClassType,
      ?publicSurface: PublicSurface, ?surfaceParams: Array<Type>,
      includeCompilerGenerated = false, ?retainedFields: Array<Field>) {
    final fields: Array<Field> = [];
    final classDisableNativeAccessors = haxe.macro.Context.defined('genes.disable_native_accessors')
      || cl.meta.has(':genes.disableNativeAccessors');
    inline function extractTsType(meta: MetaAccess): Null<String> {
      return switch meta.extract(':ts.type') {
        case [{params: [{expr: EConst(CString(type))}]}]: type;
        default:
          switch meta.extract(':genes.type') {
            case [{params: [{expr: EConst(CString(type))}]}]: type;
            default: null;
          }
      }
    }
    function paramsFor(member: PublicMember): Array<TypeParameter> {
      final params = switch cl.kind {
        case KAbstractImpl(_.get().params => params)
          if (member.ownership == AbstractInstance
            || member.ownership == AbstractConstructor):
          params.copy();
        default:
          [];
      }
      for (parameter in member.parameters) {
        if (params.filter(existing -> existing.name == parameter.name).length == 0)
          params.push(parameter);
      }
      return params;
    }
    function fieldFromPublicMember(member: PublicMember): Field {
      if (member.isConstructor) {
        return {
          kind: Constructor,
          methodKind: null,
          type: member.type,
          meta: member.meta,
          expr: member.expr,
          pos: member.pos,
          name: 'new',
          isStatic: false,
          #if (haxe_ver >= 4.2)
          isAbstract: false,
          #end
          isPublic: true,
          params: member.copyParameters(),
          doc: member.doc,
          getter: false,
          setter: false,
          tsType: null,
          overloads: [
            for (signature in member.overloads)
              fieldFromPublicMember(signature)
          ]
        };
      }
      final isVar = member.meta.has(':isVar');
      final disableNativeAccessors = member.meta.has(':genes.disableNativeAccessors')
        || classDisableNativeAccessors;
      return {
        kind: switch member.kind {
          case FVar(_, _): Property;
          case FMethod(_): Method;
        },
        methodKind: switch member.kind {
          case FMethod(kind): kind;
          case FVar(_, _): null;
        },
        meta: member.meta,
        name: member.name,
        type: member.type,
        expr: member.expr,
        pos: member.pos,
        isStatic: member.isStatic,
        #if (haxe_ver >= 4.2)
        isAbstract: member.isAbstract,
        #end
        isPublic: true,
        params: paramsFor(member),
        doc: member.doc,
        getter: !disableNativeAccessors && !isVar
          && member.kind.match(FVar(AccCall, AccCall | AccNever)),
        setter: !disableNativeAccessors && !isVar
          && member.kind.match(FVar(AccCall | AccNever, AccCall)),
        tsType: extractTsType(member.meta),
        overloads: [
          for (signature in member.overloads)
            fieldFromPublicMember(signature)
        ]
      };
    }
    if (publicSurface != null) {
      final concreteTypes = surfaceParams == null
        ? cl.params.map(parameter -> parameter.t)
        : surfaceParams;
      final constructor = publicSurface.constructorFor(concreteTypes);
      function emittedPublicName(name:String, meta:Null<MetaAccess>):String {
        final nativeName = TypeUtil.nativeName(meta);
        return nativeName == null ? name : nativeName;
      }
      function isRetained(member: PublicMember): Bool {
        return switch retainedFields {
          case null:
            true;
          case fieldsToMatch:
            Lambda.exists(fieldsToMatch, field -> field.isStatic == member.isStatic
              && (member.isConstructor
                ? field.kind.match(Constructor)
                : field.name == member.name
                  || emittedPublicName(field.name, field.meta)
                    == emittedPublicName(member.name, member.meta)));
        };
      }
      if (constructor != null && isRetained(constructor))
        fields.push(fieldFromPublicMember(constructor));
      for (member in publicSurface.instanceMembersFor(concreteTypes)) {
        if ((includeCompilerGenerated || !member.isCompilerGenerated)
          && isRetained(member))
          fields.push(fieldFromPublicMember(member));
      }
      for (member in publicSurface.staticMembersFor(concreteTypes)) {
        if ((includeCompilerGenerated || !member.isCompilerGenerated)
          && isRetained(member))
          fields.push(fieldFromPublicMember(member));
      }
      return fields;
    }
    switch cl.constructor {
      case null:
      case ctor:
        final e = ctor.get().expr();
        fields.push({
          kind: Constructor,
          methodKind: null,
          type: e.t,
          meta: null,
          expr: e,
          pos: e.pos,
          name: 'new',
          isStatic: false,
          #if (haxe_ver >= 4.2)
          isAbstract: false,
          #end
          isPublic: ctor.get().isPublic,
          params: [],
          doc: null,
          getter: false,
          setter: false,
          tsType: null,
          overloads: [
            for (signature in ctor.get().overloads.get())
              fieldFromPublicMember(PublicMember.capture(signature, false,
                true, false))
          ]
        });
    }
    for (field in cl.fields.get()) {
      final isVar = field.meta.has(':isVar');
      final disableNativeAccessors = field.meta.has(':genes.disableNativeAccessors')
        || classDisableNativeAccessors;
      fields.push({
        kind: switch field.kind {
          case FVar(_, _): Property;
          case FMethod(_): Method;
        },
        methodKind: switch field.kind {
          case FMethod(kind): kind;
          case FVar(_, _): null;
        },
        meta: field.meta,
        name: field.name,
        type: field.type,
        expr: field.expr(),
        pos: field.pos,
        isStatic: false,
        #if (haxe_ver >= 4.2)
        isAbstract: field.isAbstract,
        #end
        isPublic: field.isPublic,
        params: field.params,
        doc: field.doc,
        getter: !disableNativeAccessors && !isVar
        && field.kind.match(FVar(AccCall, AccCall | AccNever)),
        setter: !disableNativeAccessors && !isVar
        && field.kind.match(FVar(AccCall | AccNever, AccCall)),
        tsType: extractTsType(field.meta),
        overloads: [
          for (signature in field.overloads.get())
            fieldFromPublicMember(PublicMember.capture(signature, false,
              false, false))
        ]
      });
    }
    for (field in cl.statics.get()) {
      final isVar = field.meta.has(':isVar');
      final disableNativeAccessors = field.meta.has(':genes.disableNativeAccessors')
        || classDisableNativeAccessors;
      fields.push({
        kind: switch field.kind {
          case FVar(_, _): Property;
          case FMethod(_): Method;
        },
        methodKind: switch field.kind {
          case FMethod(kind): kind;
          case FVar(_, _): null;
        },
        meta: field.meta,
        name: field.name,
        type: field.type,
        expr: field.expr(),
        pos: field.pos,
        isStatic: true,
        #if (haxe_ver >= 4.2)
        isAbstract: false,
        #end
        isPublic: field.isPublic,
        params: {
          final params = switch cl.kind {
            case KAbstractImpl(_.get().params => params)
              if (PublicSurface.ownershipFor(cl, field, true)
                == AbstractInstance
                || PublicSurface.ownershipFor(cl, field, true)
                  == AbstractConstructor):
              params.copy();
            default: [];
          }
          for (param in field.params) {
            if (params.filter(p -> p.name == param.name).length > 0)
              continue;
            params.push(param);
          }
          params;
        },
        doc: field.doc,
        getter: !disableNativeAccessors && !isVar
        && field.kind.match(FVar(AccCall, AccCall | AccNever)),
        setter: !disableNativeAccessors && !isVar
        && field.kind.match(FVar(AccCall | AccNever, AccCall)),
        tsType: extractTsType(field.meta),
        overloads: [
          for (signature in field.overloads.get())
            fieldFromPublicMember(PublicMember.capture(signature, true,
              false, false, PublicSurface.ownershipFor(cl, signature, true)))
        ]
      });
    }
    return fields;
  }

  public function createContext(api: haxe.macro.JSGenApi): genes.Context {
    final typeAccessor = (type: TypeAccessor) -> switch type {
      case CoreAbstract(name) | DirectValue(name): name;
      case ImportedDeclaration(_, fallbackName, _, _, _): fallbackName;
      case ImportedAlias(_, fallbackName, _, _, _, _): fallbackName;
      case ImportedStaticField(_, fallbackName, _): fallbackName;
    }
    final context: genes.Context = {
      expr: api.generateStatement,
      value: api.generateValue,
      hasFeature: api.hasFeature,
      addFeature: api.addFeature,
      typeAccessor: typeAccessor
    }
    api.setTypeAccessor(type -> context.typeAccessor(type));
    return context;
  }
}
