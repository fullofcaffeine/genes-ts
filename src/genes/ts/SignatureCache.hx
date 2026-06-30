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
 * literal unions, and anonymous typedef field literal unions. It deliberately
 * does not store arbitrary rendered types, because that would make this cache a
 * shadow type printer.
 *
 * How: `install()` registers an `onAfterTyping` hook. At that point the compiler
 * has resolved declarations and positions, but later JS/codegen phases have not
 * erased enum abstracts from every expression. Emitters then consult this cache
 * by declaration key or source position when Haxe's current expression type has
 * become too broad for idiomatic strict TypeScript.
 */
class SignatureCache {
  @:persistent static var sigs: Map<String, CachedSig> = new Map();
  @:persistent static var fieldTsTypes: Map<String, String> = new Map();
  @:persistent static var anonFieldTsTypes: Map<String, String> = new Map();

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

  public static function install(): Void {
    // Reset for each compilation.
    sigs = new Map();
    fieldTsTypes = new Map();
    anonFieldTsTypes = new Map();

    // `onAfterTyping` runs before the JS generator rewrites types (e.g. by
    // following abstracts). Capture declared signatures for TS emission.
    Context.onAfterTyping(types -> {
      for (t in types) {
        switch t {
          case TClassDecl(ref):
            captureClass(ref.get());
          case TTypeDecl(ref):
            captureAnonFieldTypes(ref.get().type);
          default:
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
}
#end
