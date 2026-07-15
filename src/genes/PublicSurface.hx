package genes;

#if macro
import haxe.ds.ReadOnlyArray;
import haxe.macro.Context;
import haxe.macro.Expr.Position;
import haxe.macro.Type;

using haxe.macro.TypeTools;

/** Identifies the source declaration represented by a public surface. */
enum abstract PublicSurfaceKind(Int) {
  var Class;
  var Interface;
  var Typedef;
}

/**
 * Classifies the source ownership of a public member independently of runtime
 * storage.
 *
 * Why: Haxe lowers every abstract member into a static field on a synthetic
 * `KAbstractImpl` class. Treating that storage detail as source-level ownership
 * either leaks an abstract owner's type parameters onto true static methods or
 * omits them from receiver helpers, producing weak or illegal TypeScript.
 *
 * What: ordinary instance/static members remain distinct, while abstract
 * receiver helpers and abstract constructors retain their erased-runtime
 * identity. All four forms may still print as static implementation methods;
 * this fact controls generic ownership rather than target spelling.
 *
 * How: `PublicSurface.ownershipFor` recognizes the synthetic `_new` helper and
 * the leading `this` argument Haxe adds to abstract instance methods. The fact
 * is captured before DCE and reused by TS source plus classic declarations.
 */
enum abstract PublicMemberOwnership(Int) {
  var Instance;
  var Static;
  var AbstractInstance;
  var AbstractConstructor;
}

/**
 * An immutable use of a parent class or interface in a public declaration.
 *
 * Why: inheritance is part of the exported type contract, and its applied type
 * arguments must be shared by TS implementation interfaces, classic `.d.ts`,
 * and dependency planning. Reading `ClassType.interfaces` independently in
 * each printer invites target drift and loses the point at which owner generic
 * parameters must be substituted.
 *
 * What/How: the referenced Haxe type and a private copy of its arguments are
 * captured before DCE. `substitute` applies the owning declaration's concrete
 * parameters and returns a new value; callers cannot mutate the stored array.
 */
class PublicTypeUse {
  public final type: Ref<ClassType>;

  final argumentValues: Array<Type>;

  public var arguments(get, never): ReadOnlyArray<Type>;

  function get_arguments(): ReadOnlyArray<Type> {
    return argumentValues;
  }

  public function new(type: Ref<ClassType>, arguments: Array<Type>) {
    this.type = type;
    this.argumentValues = arguments.copy();
  }

  public function substitute(ownerParameters: Array<TypeParameter>,
      concreteTypes: Array<Type>): PublicTypeUse {
    return new PublicTypeUse(type, [
      for (argument in argumentValues)
        argument.applyTypeParameters(ownerParameters, concreteTypes)
    ]);
  }

  /** Returns a defensive copy for APIs that require a mutable `Array<Type>`. */
  public function copyArguments(): Array<Type> {
    return argumentValues.copy();
  }
}

/**
 * One immutable, declared member of a Haxe public type surface.
 *
 * Why: a `ClassField` belongs to mutable compiler state: DCE can remove it from
 * the owning field array, and overloads are otherwise easy for a printer to
 * overlook. Declaration consumers need a stable source-level fact instead of
 * reconstructing visibility and signatures from post-DCE runtime members.
 *
 * What: this value snapshots the facts shared by declaration-like emitters,
 * including source position, metadata, method generics, property access, and
 * every overload. Only public fields are admitted by `PublicSurface`. The
 * `isCompilerGenerated` fact is recorded instead of filtered here: generated
 * TS implementation interfaces may need a Haxe accessor method that emitted
 * class bodies call directly, while classic consumer declarations expose only
 * the property. That is profile policy, not a collection-time distinction.
 *
 * How: arrays are copied and exposed as `ReadOnlyArray`; Haxe `Type`,
 * `MetaAccess`, and `TypedExpr` values remain compiler-owned typed facts rather
 * than being rendered into target strings. Generic substitution creates a new
 * member tree, leaving the captured declaration unchanged.
 */
class PublicMember {
  public final name: String;
  public final type: Type;
  public final kind: FieldKind;
  public final meta: MetaAccess;
  public final expr: Null<TypedExpr>;
  public final pos: Position;
  public final doc: Null<String>;
  public final isStatic: Bool;
  public final isConstructor: Bool;
  public final ownership: PublicMemberOwnership;
  public final isFinal: Bool;
  public final isCompilerGenerated: Bool;
  #if (haxe_ver >= 4.2)
  public final isAbstract: Bool;
  #end

  final parameterValues: Array<TypeParameter>;
  final overloadValues: Array<PublicMember>;

  public var parameters(get, never): ReadOnlyArray<TypeParameter>;
  public var overloads(get, never): ReadOnlyArray<PublicMember>;

  function get_parameters(): ReadOnlyArray<TypeParameter> {
    return parameterValues;
  }

  function get_overloads(): ReadOnlyArray<PublicMember> {
    return overloadValues;
  }

  public function new(name: String, type: Type, kind: FieldKind,
      meta: MetaAccess, expr: Null<TypedExpr>, pos: Position,
      doc: Null<String>, isStatic: Bool, isConstructor: Bool, isFinal: Bool,
      isCompilerGenerated: Bool, ownership: PublicMemberOwnership,
      #if (haxe_ver >= 4.2) isAbstract: Bool, #end
      parameters: Array<TypeParameter>, overloads: Array<PublicMember>) {
    this.name = name;
    this.type = type;
    this.kind = kind;
    this.meta = meta;
    this.expr = expr;
    this.pos = pos;
    this.doc = doc;
    this.isStatic = isStatic;
    this.isConstructor = isConstructor;
    this.ownership = ownership;
    this.isFinal = isFinal;
    this.isCompilerGenerated = isCompilerGenerated;
    #if (haxe_ver >= 4.2)
    this.isAbstract = isAbstract;
    #end
    this.parameterValues = parameters.copy();
    this.overloadValues = overloads.copy();
  }

  public static function capture(field: ClassField, isStatic: Bool,
      isConstructor = false, captureOverloads = true,
      ?ownership: PublicMemberOwnership): PublicMember {
    final resolvedOwnership = ownership == null
      ? (isStatic ? Static : Instance)
      : ownership;
    final capturedOverloads = captureOverloads
      ? [
          for (signature in field.overloads.get())
            capture(signature, isStatic, isConstructor, false,
              resolvedOwnership)
        ]
      : [];
    return new PublicMember(field.name, field.type, field.kind, field.meta,
      field.expr(), field.pos, field.doc, isStatic, isConstructor,
      field.isFinal, field.meta.has(':compilerGenerated'), resolvedOwnership,
      #if (haxe_ver >= 4.2) field.isAbstract, #end
      field.params, capturedOverloads);
  }

  public function substitute(ownerParameters: Array<TypeParameter>,
      concreteTypes: Array<Type>): PublicMember {
    return new PublicMember(name,
      type.applyTypeParameters(ownerParameters, concreteTypes), kind, meta,
      expr, pos, doc, isStatic, isConstructor, isFinal,
      isCompilerGenerated, ownership,
      #if (haxe_ver >= 4.2) isAbstract, #end
      parameterValues, [
        for (signature in overloadValues)
          signature.substitute(ownerParameters, concreteTypes)
      ]);
  }

  /** Returns method parameters as a defensive mutable-array copy. */
  public function copyParameters(): Array<TypeParameter> {
    return parameterValues.copy();
  }

  /** Returns overload values as a defensive mutable-array copy. */
  public function copyOverloads(): Array<PublicMember> {
    return overloadValues.copy();
  }
}

/**
 * Immutable source-level API facts shared by genes-ts and classic declarations.
 *
 * Why: Haxe DCE is runtime-oriented. A consumer-visible member may disappear
 * from `ClassType.fields` even though it must remain in a TypeScript interface
 * or `.d.ts`; conversely, private accessors retained for runtime behavior must
 * not leak into public declarations. Target-local collection previously made
 * those two mistakes possible and coupled reachability to printer behavior.
 *
 * What: each class, interface, and typedef is captured after typing and before
 * DCE as declared public members, overload sets, parent applications, generic
 * parameters, and (for typedefs) the aliased type. Runtime markers and method
 * bodies remain outside this model: this is an API plan, not a universal IR.
 * Compiler-generated support members remain classified facts so each emission
 * profile can include or suppress them without maintaining another collector.
 *
 * How: `install` registers one deterministic `onAfterTyping` pass. Captured
 * arrays stay private and every concrete instantiation returns new values with
 * owner parameters substituted through `TypeTools.applyTypeParameters`.
 * TypeScript mode separately retains interface implementations for runtime.
 * Classic application DCE is never broadened by this declaration model; the
 * explicit reusable-library profile may consume it to retain selected APIs.
 */
class PublicSurface {
  @:persistent static var surfaces: Map<String, PublicSurface> = new Map();

  public final kind: PublicSurfaceKind;
  public final module: String;
  public final name: String;
  public final isPrivate: Bool;
  public final pos: Position;

  final parameterValues: Array<TypeParameter>;
  final instanceValues: Array<PublicMember>;
  final staticValues: Array<PublicMember>;
  final interfaceValues: Array<PublicTypeUse>;
  final constructorValue: Null<PublicMember>;
  final superClassValue: Null<PublicTypeUse>;
  final aliasTypeValue: Null<Type>;

  public var parameters(get, never): ReadOnlyArray<TypeParameter>;
  public var declaredInstanceMembers(get, never): ReadOnlyArray<PublicMember>;
  public var declaredStaticMembers(get, never): ReadOnlyArray<PublicMember>;
  public var declaredInterfaces(get, never): ReadOnlyArray<PublicTypeUse>;
  public var constructor(get, never): Null<PublicMember>;
  public var superClass(get, never): Null<PublicTypeUse>;
  public var aliasType(get, never): Null<Type>;

  function get_parameters(): ReadOnlyArray<TypeParameter> {
    return parameterValues;
  }

  function get_declaredInstanceMembers(): ReadOnlyArray<PublicMember> {
    return instanceValues;
  }

  function get_declaredStaticMembers(): ReadOnlyArray<PublicMember> {
    return staticValues;
  }

  function get_declaredInterfaces(): ReadOnlyArray<PublicTypeUse> {
    return interfaceValues;
  }

  function get_constructor(): Null<PublicMember> {
    return constructorValue;
  }

  function get_superClass(): Null<PublicTypeUse> {
    return superClassValue;
  }

  function get_aliasType(): Null<Type> {
    return aliasTypeValue;
  }

  function new(kind: PublicSurfaceKind, base: BaseType,
      instanceMembers: Array<PublicMember>, staticMembers: Array<PublicMember>,
      constructor: Null<PublicMember>, superClass: Null<PublicTypeUse>,
      interfaces: Array<PublicTypeUse>, aliasType: Null<Type>) {
    this.kind = kind;
    this.module = base.module;
    this.name = base.name;
    this.isPrivate = base.isPrivate;
    this.pos = base.pos;
    this.parameterValues = base.params.copy();
    this.instanceValues = instanceMembers.copy();
    this.staticValues = staticMembers.copy();
    this.constructorValue = constructor;
    this.superClassValue = superClass;
    this.interfaceValues = interfaces.copy();
    this.aliasTypeValue = aliasType;
  }

  static inline function fullName(base: BaseType): String {
    final declaredPath = base.pack.concat([base.name]).join('.');
    return (declaredPath == base.module)
      ? declaredPath
      : (base.module + '.' + base.name);
  }

  static function captureClass(cl: ClassType): PublicSurface {
    final constructor = switch cl.constructor {
      case null:
        null;
      case ctor if (ctor.get().isPublic):
        PublicMember.capture(ctor.get(), false, true, true, Instance);
      case _:
        null;
    };
    return new PublicSurface(cl.isInterface ? Interface : Class, cl, [
      for (field in cl.fields.get())
        if (field.isPublic)
          PublicMember.capture(field, false, false, true,
            ownershipFor(cl, field, false))
    ], [
      for (field in cl.statics.get())
        if (field.isPublic)
          PublicMember.capture(field, true, false, true,
            ownershipFor(cl, field, true))
    ], constructor, switch cl.superClass {
      case null: null;
      case parent: new PublicTypeUse(parent.t, parent.params);
    }, [
      for (parent in cl.interfaces)
        new PublicTypeUse(parent.t, parent.params)
    ], null);
  }

  static function captureTypedef(def: DefType): PublicSurface {
    return new PublicSurface(Typedef, def, [], [], null, null, [], def.type);
  }

  /**
   * Recovers source ownership from Haxe's typed abstract implementation shape.
   *
   * A normal static remains `Static`. On `KAbstractImpl`, `_new` represents the
   * abstract constructor and a leading argument named `this` represents the
   * erased receiver of an abstract instance member. This check deliberately
   * uses typed function arguments instead of generated target identifiers, so
   * later name allocation cannot change semantic ownership.
   */
  public static function ownershipFor(cl: ClassType, field: ClassField,
      isStatic: Bool): PublicMemberOwnership {
    if (!isStatic)
      return Instance;
    return switch cl.kind {
      case KAbstractImpl(_):
        if (field.name == '_new')
          AbstractConstructor;
        else switch field.type {
          case TFun(arguments, _) if (arguments.length > 0
            && (arguments[0].name == 'this'
              || arguments[0].name == '$' + 'this')):
            AbstractInstance;
          default:
            Static;
        }
      default:
        Static;
    };
  }

  static function captureTypes(types: Array<ModuleType>): Void {
    for (type in types) {
      final surface = switch type {
        case TClassDecl(ref): captureClass(ref.get());
        case TTypeDecl(ref): captureTypedef(ref.get());
        default: null;
      };
      if (surface != null)
        surfaces.set(fullName(switch type {
          case TClassDecl(ref): ref.get();
          case TTypeDecl(ref): ref.get();
          default: throw 'unreachable';
        }), surface);
    }
  }

  static inline function keepField(field: ClassField): Void {
    if (!field.meta.has(':keep'))
      field.meta.add(':keep', [], field.pos);
  }

  static function collectInterfaceFieldNames(iface: ClassType,
      names: Map<String, Bool>, seen: Map<String, Bool>): Void {
    final key = fullName(iface);
    if (seen.exists(key))
      return;
    seen.set(key, true);
    final surface = forClass(iface);
    for (member in surface.declaredInstanceMembers) {
      names.set(member.name, true);
      switch member.kind {
        case FVar(read, write):
          if (read.match(AccCall))
            names.set('get_${member.name}', true);
          if (write.match(AccCall))
            names.set('set_${member.name}', true);
        case FMethod(_):
      }
    }
    for (parent in surface.declaredInterfaces)
      collectInterfaceFieldNames(parent.type.get(), names, seen);
  }

  /**
   * Retains the runtime methods required by a closed interface contract.
   *
   * Why: generated TS interfaces remain complete after DCE, so their concrete
   * implementations must still contain the matching runtime methods. Keeping
   * every public class field would defeat DCE and change classic JS output.
   *
   * What/How: only fields named by implemented interfaces (including inherited
   * interfaces) receive `@:keep`, on the class or superclass that owns them.
   * Private generated accessors may satisfy a public Haxe property and are
   * therefore retained for runtime, but they never enter `PublicSurface`.
   */
  static function retainInterfaceContract(cl: ClassType): Void {
    if (cl.isInterface || cl.interfaces.length == 0)
      return;

    final names = new Map<String, Bool>();
    final seen = new Map<String, Bool>();
    for (iface in cl.interfaces)
      collectInterfaceFieldNames(iface.t.get(), names, seen);

    var current: Null<ClassType> = cl;
    while (current != null) {
      for (field in current.fields.get()) {
        if (names.exists(field.name))
          keepField(field);
      }
      current = switch current.superClass {
        case null: null;
        case parent: parent.t.get();
      };
    }
  }

  /** Installs pre-DCE capture for one compiler invocation. */
  public static function install(): Void {
    surfaces = new Map();
    Context.onAfterTyping(types -> {
      captureTypes(types);
      LibraryProfile.retain(types);
      if (Context.defined('genes.ts')) {
        for (type in types) {
          switch type {
            case TClassDecl(ref): retainInterfaceContract(ref.get());
            default:
          }
        }
      }
    });
  }

  /** Returns the captured class/interface surface, with a post-DCE fallback. */
  public static function forClass(cl: ClassType): PublicSurface {
    final key = fullName(cl);
    final found = surfaces.get(key);
    if (found != null)
      return found;
    final fallback = captureClass(cl);
    surfaces.set(key, fallback);
    return fallback;
  }

  /** Returns the captured typedef surface, with a post-DCE fallback. */
  public static function forTypedef(def: DefType): PublicSurface {
    final key = fullName(def);
    final found = surfaces.get(key);
    if (found != null)
      return found;
    final fallback = captureTypedef(def);
    surfaces.set(key, fallback);
    return fallback;
  }

  function validateConcreteTypes(concreteTypes: Array<Type>): Void {
    if (parameterValues.length != concreteTypes.length) {
      CompilerDiagnostic.fail('PublicSurface generic arity mismatch for $module.$name: '
        + 'expected ${parameterValues.length}, received ${concreteTypes.length}',
        pos);
    }
  }

  /** Returns declared instance members with owner generics substituted. */
  public function instanceMembersFor(concreteTypes: Array<Type>): Array<PublicMember> {
    validateConcreteTypes(concreteTypes);
    return [
      for (member in instanceValues)
        member.substitute(parameterValues, concreteTypes)
    ];
  }

  /** Returns declared static members with owner generics substituted. */
  public function staticMembersFor(concreteTypes: Array<Type>): Array<PublicMember> {
    validateConcreteTypes(concreteTypes);
    return [
      for (member in staticValues)
        member.substitute(parameterValues, concreteTypes)
    ];
  }

  /** Returns the public constructor with owner generics substituted. */
  public function constructorFor(concreteTypes: Array<Type>): Null<PublicMember> {
    validateConcreteTypes(concreteTypes);
    return constructorValue == null
      ? null
      : constructorValue.substitute(parameterValues, concreteTypes);
  }

  /** Returns the applied superclass with owner generics substituted. */
  public function superClassFor(concreteTypes: Array<Type>): Null<PublicTypeUse> {
    validateConcreteTypes(concreteTypes);
    return superClassValue == null
      ? null
      : superClassValue.substitute(parameterValues, concreteTypes);
  }

  /** Returns applied interfaces with owner generics substituted. */
  public function interfacesFor(concreteTypes: Array<Type>): Array<PublicTypeUse> {
    validateConcreteTypes(concreteTypes);
    return [
      for (parent in interfaceValues)
        parent.substitute(parameterValues, concreteTypes)
    ];
  }

  /** Returns the typedef body with owner generics substituted. */
  public function aliasTypeFor(concreteTypes: Array<Type>): Type {
    validateConcreteTypes(concreteTypes);
    if (aliasTypeValue == null) {
      return CompilerDiagnostic.fail(
        'PublicSurface $module.$name is not a typedef', pos);
    }
    return aliasTypeValue.applyTypeParameters(parameterValues, concreteTypes);
  }
}
#end
