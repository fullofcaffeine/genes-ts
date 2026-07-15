package genes.ts;

import haxe.macro.Context;
import haxe.macro.Expr.Position;
import haxe.macro.Type;

typedef CachedArg = {
  final opt: Bool;
  final allowsNull: Bool;
  final tsType: Null<String>;
}

typedef CachedSig = {
  final args: Array<CachedArg>;
  final retTsType: Null<String>;
}

#if macro
/**
 * Captures declaration-time TypeScript typing facts before Haxe/Genes lowering
 * follows abstracts into their runtime representation.
 *
 * Why: enum abstracts such as DOM string enums are strong Haxe types at the
 * source boundary, but later typed expression nodes often look like plain
 * `String`. The TypeScript emitter still needs the source-level contract so it
 * can print `"a" | "b"` instead of widening locals, fields, and typedef members
 * back to `string`.
 *
 * What: this cache records only narrow facts that the normal emitter already
 * knows how to print safely: method argument/return literal unions, class field
 * literal unions, anonymous typedef field literal unions, and the declared
 * public fields of interfaces. In TypeScript implementation mode it also marks
 * interface contracts and their concrete implementations as DCE roots. In
 * classic declaration mode it leaves runtime DCE untouched and supplies the
 * captured fields only to the declaration emitter. It deliberately does not
 * store arbitrary rendered types, because that would make this cache a shadow
 * type printer.
 *
 * How: `install()` registers an `onAfterTyping` hook. At that point the compiler
 * has resolved declarations and positions, but later JS/codegen phases have not
 * erased enum abstracts from every expression or removed unused public fields
 * through DCE. Emitters then consult this cache by declaration key or source
 * position when Haxe's generator-time view has become too broad or too small
 * for idiomatic strict TypeScript.
 */
class SignatureCache {
  @:persistent static var sigs: Map<String, CachedSig> = new Map();
  @:persistent static var fieldTsTypes: Map<String, String> = new Map();
  @:persistent static var anonFieldTsTypes: Map<String, String> = new Map();
  @:persistent static var publicInterfaceFields: Map<String,
    Array<ClassField>> = new Map();

  static inline function classFullName(cl: ClassType): String {
    final declaredPath = cl.pack.concat([cl.name]).join('.');
    return (declaredPath == cl.module) ? declaredPath : (cl.module + '.' + cl.name);
  }

  static inline function keyFor(clFullName: String, isStatic: Bool,
      fieldName: String): String {
    return clFullName + '::' + (isStatic ? 'S:' : 'I:') + fieldName;
  }

  static function posKey(pos: Position): String {
    final info = Context.getPosInfos(pos);
    return info.file + ':' + info.min + ':' + info.max;
  }

  static function unlazy(t: Type): Type {
    return switch t {
      case TLazy(f):
        unlazy(f());
      default:
        t;
    }
  }

  static function typeVisitKey(t: Type): Null<String> {
    return switch unlazy(t) {
      case TType(_.get() => dt, _):
        'T:' + dt.module + '.' + dt.name;
      case TAbstract(_.get() => ab, _):
        'A:' + ab.module + '.' + ab.name;
      default:
        null;
    }
  }

  static function followTypedefs(t: Type, ?seen: Map<String, Bool>): Type {
    if (seen == null)
      seen = new Map();
    return switch unlazy(t) {
      case TType(_, _):
        final key = typeVisitKey(t);
        if (key != null) {
          if (seen.exists(key))
            return t;
          seen.set(key, true);
        }
        followTypedefs(Context.follow(t), seen);
      default:
        t;
    }
  }

  static function typeAllowsNull(t: Type): Bool {
    return switch followTypedefs(unlazy(t)) {
      case TAbstract(_.get() => {pack: [], name: "Null"}, _):
        true;
      case TType(_.get() => {pack: [], name: "Null"}, _):
        true;
      case TDynamic(_):
        true;
      case TMono(tref):
        final inner = tref.get();
        inner == null ? true : typeAllowsNull(inner);
      default:
        false;
    }
  }

  static function stripOptionalFieldNull(t: Type): Type {
    return switch unlazy(t) {
      case TAbstract(_.get() => {pack: [], name: "Null"}, [inner]) |
        TType(_.get() => {pack: [], name: "Null"}, [inner]):
        inner;
      default:
        t;
    }
  }

  public static function enumAbstractLiteralUnionTsType(t: Type): Null<String> {
    final normalized = followTypedefs(unlazy(t));
    switch normalized {
      case TAbstract(_.get() => {pack: [], name: "Null"}, [inner]):
        final innerUnion = enumAbstractLiteralUnionTsType(inner);
        if (innerUnion == null)
          return null;
        return Context.defined('genes.ts.no_null_union') ? innerUnion : (innerUnion + ' | null');
      case TType(_.get() => {pack: [], name: "Null"}, [inner]):
        final innerUnion = enumAbstractLiteralUnionTsType(inner);
        if (innerUnion == null)
          return null;
        return Context.defined('genes.ts.no_null_union') ? innerUnion : (innerUnion + ' | null');
      case TAbstract(_.get() => ab, _):
        if (!ab.meta.has(':enum'))
          return null;
        // Use TypeEmitter so we reuse the same enum-abstract value extraction
        // logic as the TS emitter.
        final buf = new StringBuf();
        final writer: genes.dts.TypeEmitter.TypeWriter = {
          write: code -> buf.add(code),
          writeNewline: () -> {},
          emitComment: _ -> {},
          increaseIndent: () -> {},
          decreaseIndent: () -> {},
          emitPos: _ -> {},
          includeType: _ -> {},
          typeAccessor: _ -> 'X'
        };
        genes.dts.TypeEmitter.emitType(writer, normalized);
        final out = buf.toString();
        // Only accept literal unions and singleton literals; if we couldn't
        // determine values we'll fall back to normal TypeEmitter emission at
        // generation time.
        return isLiteralTsType(out) ? out : null;
      default:
        return null;
    }
  }

  static function isLiteralTsType(out: String): Bool {
    return out.indexOf('|') > -1
      || StringTools.startsWith(out, '"')
      || out == 'true'
      || out == 'false'
      || ~/^-?[0-9]+(\.[0-9]+)?$/.match(out);
  }

  static function storeSig(cl: ClassType, isStatic: Bool, fieldName: String,
      fnType: Type): Void {
    switch unlazy(fnType) {
      case TFun(args, ret):
        sigs.set(keyFor(classFullName(cl), isStatic, fieldName), {
          args: [for (a in args) {
            opt: a.opt,
            allowsNull: typeAllowsNull(a.t),
            tsType: enumAbstractLiteralUnionTsType(a.t)
          }],
          retTsType: enumAbstractLiteralUnionTsType(ret)
        });
      default:
    }
  }

  static function storeFieldType(cl: ClassType, isStatic: Bool,
      fieldName: String, type: Type): Void {
    final tsType = enumAbstractLiteralUnionTsType(type);
    if (tsType != null)
      fieldTsTypes.set(keyFor(classFullName(cl), isStatic, fieldName), tsType);
  }

  static function captureAnonFieldTypes(type: Type, ?seen: Map<String, Bool>): Void {
    if (seen == null)
      seen = new Map();
    switch unlazy(type) {
      case TAbstract(_.get() => {pack: [], name: "Null"}, [inner]) |
        TType(_.get() => {pack: [], name: "Null"}, [inner]):
        captureAnonFieldTypes(inner, seen);
      case TType(_, _):
        final key = typeVisitKey(type);
        if (key != null) {
          if (seen.exists(key))
            return;
          seen.set(key, true);
        }
        captureAnonFieldTypes(Context.follow(type), seen);
      case TAnonymous(_.get() => anon):
        for (field in anon.fields) {
          // `@:ts.optional` means TS callers see omission/undefined, not null.
          // Capture literal unions from that emitted contract so the later
          // TypeEmitter cache does not reintroduce Haxe's optional-field Null.
          final fieldType = field.meta.has(':ts.optional')
            ? stripOptionalFieldNull(field.type)
            : field.type;
          final tsType = enumAbstractLiteralUnionTsType(fieldType);
          if (tsType != null)
            anonFieldTsTypes.set(posKey(field.pos), tsType);
          captureAnonFieldTypes(field.type, seen);
        }
      default:
    }
  }

  static function captureClass(cl: ClassType): Void {
    if (cl.isInterface) {
      // Hold the declared ClassField values themselves rather than rendered
      // strings. Their typed signatures remain authoritative, while the copied
      // array is insulated from the later DCE mutation of `cl.fields`.
      publicInterfaceFields.set(classFullName(cl), [
        for (field in cl.fields.get())
          if (field.isPublic) field
      ]);
    }

    switch cl.constructor {
      case null:
      case ctor:
        final e = ctor.get().expr();
        if (e != null)
          storeSig(cl, false, 'new', e.t);
    }

    for (f in cl.fields.get()) {
      switch f.kind {
        case FMethod(_):
          storeSig(cl, false, f.name, f.type);
        case FVar(_, _):
          storeFieldType(cl, false, f.name, f.type);
      }
    }
    for (f in cl.statics.get()) {
      switch f.kind {
        case FMethod(_):
          storeSig(cl, true, f.name, f.type);
        case FVar(_, _):
          storeFieldType(cl, true, f.name, f.type);
      }
    }
  }

  static inline function keepField(field: ClassField): Void {
    if (!field.meta.has(':keep'))
      field.meta.add(':keep', [], field.pos);
  }

  static function collectInterfaceFieldNames(iface: ClassType,
      names: Map<String, Bool>, seen: Map<String, Bool>): Void {
    final key = classFullName(iface);
    if (seen.exists(key))
      return;
    seen.set(key, true);
    for (field in iface.fields.get()) {
      if (field.isPublic)
        names.set(field.name, true);
    }
    for (parent in iface.interfaces)
      collectInterfaceFieldNames(parent.t.get(), names, seen);
  }

  /**
   * Retains a closed interface contract and the methods that implement it.
   *
   * Why: Haxe DCE is driven by calls in the Haxe program, whereas emitted
   * TypeScript interfaces are consumed after Haxe compilation. Keeping only the
   * reached members either makes the interface incomplete or forces an unsafe
   * catch-all index signature. Conversely, keeping every public field in every
   * typed module pulls compiler/macro-only APIs into runtime output and defeats
   * useful DCE.
   *
   * What/How: for concrete classes that nominally implement an interface,
   * matching fields are retained on the class or the superclass that actually
   * owns them. The interface declarations themselves are captured separately,
   * not marked `@:keep`: retaining a type used by no emitted module would add
   * unjustified declaration/runtime-marker modules to every output. Retained
   * method bodies let normal Haxe DCE keep their private runtime dependencies.
   * This is deliberately an incremental public-surface plan; an explicit
   * dependency graph can later generalize retention for exported classes.
   */
  static function retainInterfaceContract(cl: ClassType): Void {
    if (cl.isInterface)
      return;
    if (cl.interfaces.length == 0)
      return;

    final names = new Map<String, Bool>();
    final seen = new Map<String, Bool>();
    for (iface in cl.interfaces)
      collectInterfaceFieldNames(iface.t.get(), names, seen);

    var current: Null<ClassType> = cl;
    while (current != null) {
      for (field in current.fields.get()) {
        // A public Haxe property may satisfy an interface through a private
        // generated accessor such as `get_disposed`. Match the contractual
        // field name regardless of the accessor's source visibility.
        if (names.exists(field.name))
          keepField(field);
      }
      current = switch current.superClass {
        case null: null;
        case parent: parent.t.get();
      };
    }
  }

  public static function install(): Void {
    // Reset for each compilation.
    sigs = new Map();
    fieldTsTypes = new Map();
    anonFieldTsTypes = new Map();
    publicInterfaceFields = new Map();

    // `onAfterTyping` runs before the JS generator rewrites types (e.g. by
    // following abstracts). Capture declared signatures for TS emission.
    Context.onAfterTyping(types -> {
      // Capture source-level facts first, before retention metadata can affect
      // later compiler phases or ordering among declarations.
      for (t in types) {
        switch t {
          case TClassDecl(ref):
            captureClass(ref.get());
          case TTypeDecl(ref):
            captureAnonFieldTypes(ref.get().type);
          default:
        }
      }
      if (Context.defined('genes.ts')) {
        for (t in types) {
          switch t {
            case TClassDecl(ref):
              retainInterfaceContract(ref.get());
            default:
          }
        }
      }
    });
  }

  public static function getSig(cl: ClassType, isStatic: Bool,
      fieldName: String): Null<CachedSig> {
    return sigs.get(keyFor(classFullName(cl), isStatic, fieldName));
  }

  public static function getFieldTsType(cl: ClassType, isStatic: Bool,
      fieldName: String): Null<String> {
    return fieldTsTypes.get(keyFor(classFullName(cl), isStatic, fieldName));
  }

  public static function getAnonFieldTsType(pos: Position): Null<String> {
    return anonFieldTsTypes.get(posKey(pos));
  }

  /**
   * Returns the complete declared public surface of an interface.
   *
   * Why: Haxe DCE is runtime-oriented and can remove interface members that
   * generated TypeScript consumers still need for type checking. Reopening the
   * interface with `[key: string]: any` hides that loss and makes arbitrary
   * member access legal.
   *
   * What/How: `onAfterTyping` captures the typed `ClassField` values before
   * DCE mutates the class field array. The emitter receives a fresh array so it
   * cannot mutate persistent compiler state. Inherited interface members remain
   * represented by TypeScript `extends`; this returns declared members only.
   */
  public static function getPublicInterfaceFields(cl: ClassType): Null<Array<ClassField>> {
    final fields = publicInterfaceFields.get(classFullName(cl));
    return fields == null ? null : fields.copy();
  }
}
#end
