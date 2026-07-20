package genes.ts;

import genes.NullishContract;
import haxe.macro.Context;
import haxe.macro.Expr.Position;
import haxe.macro.Type;

using haxe.macro.TypeTools;

typedef CachedArg = {
  final opt: Bool;
  final allowsNull: Bool;
  final preservesUndefined: Bool;
  final tsType: Null<String>;
  final sourceType: Null<Type>;
}

typedef CachedSig = {
  final args: Array<CachedArg>;
  final retTsType: Null<String>;
  final retSourceType: Null<Type>;
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
 * knows how to print safely: direct literal-union spellings plus compiler-owned
 * source `Type` values that contain an enum abstract. The latter lets the normal
 * recursive type printer preserve a closed leaf below functions, arrays,
 * nullability, aliases, and generic containers without maintaining a shadow
 * TypeScript renderer. Public API facts remain owned by the target-neutral
 * `genes.PublicSurface`; this cache only recovers types erased before target
 * emission.
 *
 * How: `install()` registers an `onAfterTyping` hook. At that point the compiler
 * has resolved declarations and positions, but later JS/codegen phases have not
 * erased enum abstracts from every expression. Emitters then consult this cache
 * by declaration key or source position when Haxe's generator-time view has
 * become too broad for idiomatic strict TypeScript.
 */
class SignatureCache {
  @:persistent static var sigs: Map<String, CachedSig> = new Map();
  @:persistent static var fieldTsTypes: Map<String, String> = new Map();
  @:persistent static var anonFieldTsTypes: Map<String, String> = new Map();
  @:persistent static var fieldSourceTypes: Map<String, Type> = new Map();
  @:persistent static var anonFieldSourceTypes: Map<String, Type> = new Map();
  @:persistent static var typedefSourceTypes: Map<String, Type> = new Map();
  @:persistent static var localSourceTypes: Map<Int, Type> = new Map();
  @:persistent static var enumAbstractTsTypes: Map<String, String> = new Map();

  static inline function classFullName(cl: ClassType): String {
    final declaredPath = cl.pack.concat([cl.name]).join('.');
    return (declaredPath == cl.module) ? declaredPath : (cl.module + '.' + cl.name);
  }

  static inline function keyFor(clFullName: String, isStatic: Bool,
      fieldName: String): String {
    return clFullName + '::' + (isStatic ? 'S:' : 'I:') + fieldName;
  }

  static inline function abstractKey(ab: AbstractType): String {
    return ab.module + '.' + ab.name;
  }

  static inline function typedefKey(def: DefType): String {
    final declaredPath = def.pack.concat([def.name]).join('.');
    return declaredPath == def.module
      ? declaredPath
      : def.module + '.' + def.name;
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

  /**
   * Retains one source type only when an enum abstract occurs within it.
   *
   * The walk checks supplied type arguments before following aliases, so a
   * generic use such as `Envelope<Phase>` remains the authored nominal type
   * while still proving that its leaf needs pre-erasure recovery. Named alias
   * cycles are bounded and unresolved monomorphs fall back to the ordinary
   * generator-time type instead of inventing a projection.
   */
  static function sourceTypeWithEnumAbstract(t: Type, depth = 0,
      ?seen: Map<String, Bool>): Null<Type> {
    if (depth > 64)
      return null;
    if (seen == null)
      seen = new Map();

    final contains = switch unlazy(t) {
      case TAbstract(_.get() => ab, params):
        if (ab.meta.has(':enum')) {
          true;
        } else if (typesContainEnumAbstract(params, depth + 1, seen)) {
          true;
        } else {
          final key = 'A:' + ab.module + '.' + ab.name;
          if (seen.exists(key)) {
            false;
          } else {
            seen.set(key, true);
            sourceTypeWithEnumAbstract(
              ab.type.applyTypeParameters(ab.params, params), depth + 1,
              seen) != null;
          }
        }
      case TType(_.get() => def, params):
        if (typesContainEnumAbstract(params, depth + 1, seen)) {
          true;
        } else {
          final key = 'T:' + def.module + '.' + def.name;
          if (seen.exists(key)) {
            false;
          } else {
            seen.set(key, true);
            sourceTypeWithEnumAbstract(Context.follow(t), depth + 1,
              seen) != null;
          }
        }
      case TInst(_, params) | TEnum(_, params):
        typesContainEnumAbstract(params, depth + 1, seen);
      case TFun(args, ret):
        var found = sourceTypeWithEnumAbstract(ret, depth + 1, seen) != null;
        if (!found) {
          for (arg in args) {
            if (sourceTypeWithEnumAbstract(arg.t, depth + 1, seen) != null) {
              found = true;
              break;
            }
          }
        }
        found;
      case TAnonymous(_.get() => anon):
        var found = false;
        for (field in anon.fields) {
          if (sourceTypeWithEnumAbstract(field.type, depth + 1, seen) != null) {
            found = true;
            break;
          }
        }
        found;
      case TDynamic(inner) if (inner != null):
        sourceTypeWithEnumAbstract(inner, depth + 1, seen) != null;
      case TMono(reference) if (reference.get() != null):
        sourceTypeWithEnumAbstract(reference.get(), depth + 1, seen) != null;
      default:
        false;
    };
    return contains ? t : null;
  }

  static function typesContainEnumAbstract(types: Array<Type>, depth: Int,
      seen: Map<String, Bool>): Bool {
    for (type in types)
      if (sourceTypeWithEnumAbstract(type, depth, seen) != null)
        return true;
    return false;
  }

  static function isDirectEnumAbstractType(t: Type): Bool {
    return switch followTypedefs(unlazy(t)) {
      case TAbstract(_.get() => {pack: [], name: "Null"}, [inner]) |
        TType(_.get() => {pack: [], name: "Null"}, [inner]):
        isDirectEnumAbstractType(inner);
      case TAbstract(_.get() => ab, _):
        ab.meta.has(':enum');
      default:
        false;
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
            final nullish = NullishContract.forType(a.t);
            {
              opt: a.opt,
              allowsNull: nullish.haxeAllowsNull,
              preservesUndefined: nullish.preservesUndefined,
              tsType: enumAbstractLiteralUnionTsType(a.t),
              sourceType: sourceTypeWithEnumAbstract(a.t)
            }
          }],
          retTsType: enumAbstractLiteralUnionTsType(ret),
          retSourceType: sourceTypeWithEnumAbstract(ret)
        });
      default:
    }
  }

  static function storeFieldType(cl: ClassType, isStatic: Bool,
      field: ClassField): Void {
    final tsType = enumAbstractLiteralUnionTsType(
      NullishContract.forField(field).emittedType);
    if (tsType != null)
      fieldTsTypes.set(keyFor(classFullName(cl), isStatic, field.name), tsType);
    final sourceType = sourceTypeWithEnumAbstract(
      NullishContract.forField(field).emittedType);
    if (sourceType != null)
      fieldSourceTypes.set(keyFor(classFullName(cl), isStatic, field.name),
        sourceType);
  }

  static function captureAnonFieldTypes(type: Type, depth = 0): Void {
    if (depth > 64)
      return;
    switch unlazy(type) {
      case TAbstract(_.get() => {pack: [], name: "Null"}, [inner]) |
        TType(_.get() => {pack: [], name: "Null"}, [inner]):
        captureAnonFieldTypes(inner, depth + 1);
      case TAnonymous(_.get() => anon):
        for (field in anon.fields) {
          // `@:ts.optional` means TS callers see omission/undefined, not null.
          // Capture literal unions from that emitted contract so the later
          // TypeEmitter cache does not reintroduce Haxe's optional-field Null.
          final fieldType = NullishContract.forField(field).emittedType;
          final tsType = enumAbstractLiteralUnionTsType(fieldType);
          if (tsType != null)
            anonFieldTsTypes.set(posKey(field.pos), tsType);
          final sourceType = sourceTypeWithEnumAbstract(fieldType);
          if (sourceType != null)
            anonFieldSourceTypes.set(posKey(field.pos), sourceType);
          captureAnonFieldTypes(field.type, depth + 1);
        }
      case TInst(_, params) | TEnum(_, params) | TAbstract(_, params) |
        TType(_, params):
        // Visit only authored type arguments. Following a named typedef here
        // would overwrite its generic declaration fields with one concrete use
        // (for example, turning `Envelope<Value>` into `Envelope<Phase>`).
        for (param in params)
          captureAnonFieldTypes(param, depth + 1);
      case TFun(args, ret):
        for (arg in args)
          captureAnonFieldTypes(arg.t, depth + 1);
        captureAnonFieldTypes(ret, depth + 1);
      case TDynamic(inner) if (inner != null):
        captureAnonFieldTypes(inner, depth + 1);
      case TMono(reference) if (reference.get() != null):
        captureAnonFieldTypes(reference.get(), depth + 1);
      default:
    }
  }

  static function captureLocal(variable: TVar, includeDirect = false): Void {
    final sourceType = sourceTypeWithEnumAbstract(variable.t);
    // Direct enum locals retain the existing conservative expression-flow
    // policy: a lowered mutable loop temporary stays broad and receives its
    // contained call-boundary assertion. Structural locals need their complete
    // source type, while function parameters are declaration-safe even when
    // their enum domain is direct.
    if (sourceType != null
      && (includeDirect || !isDirectEnumAbstractType(variable.t)))
      localSourceTypes.set(variable.id, sourceType);
  }

  static function captureExpression(expression: TypedExpr): Void {
    switch expression.expr {
      case TVar(variable, _):
        captureLocal(variable);
      case TFunction(fn):
        for (arg in fn.args)
          captureLocal(arg.v, true);
      case TTry(_, catches):
        for (entry in catches)
          captureLocal(entry.v);
      default:
    }
    haxe.macro.TypedExprTools.iter(expression, captureExpression);
  }

  static function captureClass(cl: ClassType): Void {
    switch cl.constructor {
      case null:
      case ctor:
        final e = ctor.get().expr();
        if (e != null) {
          storeSig(cl, false, 'new', e.t);
          captureExpression(e);
        }
    }

    for (f in cl.fields.get()) {
      switch f.kind {
        case FMethod(_):
          storeSig(cl, false, f.name, f.type);
        case FVar(_, _):
          storeFieldType(cl, false, f);
      }
      final expression = f.expr();
      if (expression != null)
        captureExpression(expression);
    }
    for (f in cl.statics.get()) {
      switch f.kind {
        case FMethod(_):
          storeSig(cl, true, f.name, f.type);
        case FVar(_, _):
          storeFieldType(cl, true, f);
      }
      final expression = f.expr();
      if (expression != null)
        captureExpression(expression);
    }
  }

  static function captureEnumAbstract(reference: Ref<AbstractType>): Void {
    final ab = reference.get();
    if (!ab.meta.has(':enum'))
      return;
    final sourceType = TAbstract(reference, [for (param in ab.params) param.t]);
    final tsType = enumAbstractLiteralUnionTsType(sourceType);
    if (tsType != null)
      enumAbstractTsTypes.set(abstractKey(ab), tsType);
  }

  public static function install(): Void {
    // Reset for each compilation.
    sigs = new Map();
    fieldTsTypes = new Map();
    anonFieldTsTypes = new Map();
    fieldSourceTypes = new Map();
    anonFieldSourceTypes = new Map();
    typedefSourceTypes = new Map();
    localSourceTypes = new Map();
    enumAbstractTsTypes = new Map();

    // `onAfterTyping` runs before the JS generator rewrites types (e.g. by
    // following abstracts). Capture declared signatures for TS emission.
    Context.onAfterTyping(types -> {
      for (t in types) {
        switch t {
          case TClassDecl(ref):
            captureClass(ref.get());
          case TTypeDecl(ref):
            final definition = ref.get();
            final sourceType = sourceTypeWithEnumAbstract(definition.type);
            if (sourceType != null)
              typedefSourceTypes.set(typedefKey(definition), sourceType);
            // A typedef declaration can expose its own anonymous structure
            // through a compiler wrapper. Follow that root once, then the
            // recursive collector deliberately does not follow named field
            // typedefs, which would specialize a generic declaration using a
            // concrete consumer.
            captureAnonFieldTypes(Context.follow(definition.type));
          case TAbstract(ref):
            captureEnumAbstract(ref);
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

  public static function getFieldSourceType(cl: ClassType, isStatic: Bool,
      fieldName: String): Null<Type> {
    return fieldSourceTypes.get(keyFor(classFullName(cl), isStatic, fieldName));
  }

  public static function getAnonFieldSourceType(pos: Position): Null<Type> {
    return anonFieldSourceTypes.get(posKey(pos));
  }

  public static function getTypedefSourceType(def: DefType,
      parameters: Array<Type>): Null<Type> {
    final sourceType = typedefSourceTypes.get(typedefKey(def));
    if (sourceType == null)
      return null;
    return parameters.length == def.params.length
      ? sourceType.applyTypeParameters(def.params, parameters)
      : sourceType;
  }

  public static function getLocalSourceType(variable: TVar): Null<Type> {
    return localSourceTypes.get(variable.id);
  }

  /** Frozen literal spelling used after DCE removes enum implementation fields. */
  public static function getEnumAbstractTsType(ab: AbstractType): Null<String> {
    return enumAbstractTsTypes.get(abstractKey(ab));
  }
}
#end
