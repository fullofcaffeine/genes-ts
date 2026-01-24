package genes.ts;

import haxe.macro.Context;
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
class SignatureCache {
  @:persistent static var sigs: Map<String, CachedSig> = new Map();

  static inline function classFullName(cl: ClassType): String {
    final declaredPath = cl.pack.concat([cl.name]).join('.');
    return (declaredPath == cl.module) ? declaredPath : (cl.module + '.' + cl.name);
  }

  static inline function keyFor(clFullName: String, isStatic: Bool,
      fieldName: String): String {
    return clFullName + '::' + (isStatic ? 'S:' : 'I:') + fieldName;
  }

  static function unlazy(t: Type): Type {
    return switch t {
      case TLazy(f):
        unlazy(f());
      default:
        t;
    }
  }

  static function followTypedefs(t: Type): Type {
    return switch t {
      case TType(_, _):
        followTypedefs(Context.follow(t));
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

  static function enumAbstractLiteralUnionTsType(t: Type): Null<String> {
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
        // Only accept literal unions; if we couldn't determine values we'll
        // fall back to normal TypeEmitter emission at generation time.
        return (out.indexOf('|') > -1) ? out : null;
      default:
        return null;
    }
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
      }
    }
    for (f in cl.statics.get()) {
      switch f.kind {
        case FMethod(_):
          storeSig(cl, true, f.name, f.type);
        case FVar(_, _):
      }
    }
  }

  public static function install(): Void {
    // Reset for each compilation.
    sigs = new Map();

    // `onAfterTyping` runs before the JS generator rewrites types (e.g. by
    // following abstracts). Capture declared signatures for TS emission.
    Context.onAfterTyping(types -> {
      for (t in types) {
        switch t {
          case TClassDecl(ref):
            captureClass(ref.get());
          default:
        }
      }
    });
  }

  public static function getSig(cl: ClassType, isStatic: Bool,
      fieldName: String): Null<CachedSig> {
    return sigs.get(keyFor(classFullName(cl), isStatic, fieldName));
  }
}
#end
