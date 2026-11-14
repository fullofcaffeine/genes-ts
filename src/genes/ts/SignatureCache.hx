package genes.ts;

import genes.AfterTypingPasses.AfterTypingClass;
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
 * Saves source-level TypeScript typing facts before Haxe simplifies them for
 * JavaScript runtime output.
 *
 * Why: enum abstracts such as DOM string enums are strong Haxe types at the
 * source boundary, but the later compiler view often looks like plain
 * `String`. The TypeScript emitter still needs the original contract so it
 * can print `"a" | "b"` instead of widening locals, fields, and typedef members
 * back to `string`.
 *
 * What: this cache records only narrow facts that the normal emitter already
 * knows how to print safely: direct literal-union spellings plus compiler-owned
 * source `Type` values that contain an enum abstract. The saved type lets the
 * normal recursive type printer preserve a closed leaf below functions, arrays,
 * nullability, aliases, and generic containers without maintaining a shadow
 * TypeScript renderer. Public API facts remain owned by the target-neutral
 * `genes.PublicSurface`; this cache only recovers types erased before target
 * emission.
 *
 * How: `install()` adds its capture to the `onAfterTyping` walk that
 * `genes.AfterTypingPasses` shares between the pre-DCE passes. At that point
 * the compiler has resolved declarations and positions, but later JS/codegen
 * phases have not erased enum abstracts from every expression. Emitters then
 * consult this cache by declaration key or source position when Haxe's
 * JavaScript-oriented view has become too broad for accurate strict
 * TypeScript.
 */
class SignatureCache {
  @:persistent static var sigs: Map<String, CachedSig> = new Map();
  @:persistent static var fieldTsTypes: Map<String, String> = new Map();
  @:persistent static var anonFieldTsTypes: Map<String, String> = new Map();
  @:persistent static var fieldSourceTypes: Map<String, Type> = new Map();
  @:persistent static var anonFieldSourceTypes: Map<String, Type> = new Map();
  @:persistent static var typedefSourceTypes: Map<String, Type> = new Map();
  @:persistent static var localSourceTypes: Map<Int, Type> = new Map();
  @:persistent static var directEnumLocalSourceTypes: Map<Int,
    Type> = new Map();
  @:persistent static var enumAbstractTsTypes: Map<String, String> = new Map();
  @:persistent static var enumConstructorSourceTypes: Map<String,
    Type> = new Map();

  /**
   * Request-local answers to "does the own body of this abstract or typedef
   * contain an enum abstract?".
   *
   * Why: one real application asked 52,600 such questions in one request and
   * entered declaration bodies 268,600 times to answer them, because each use
   * of `Null`, `Int` or a large record typedef walked that declaration again.
   *
   * What: the key is the declaration kind and its Haxe type path, the same
   * identity as the recursion guard of the walk. The value is
   * `ENUM_ABSTRACT`, `BODY_WITHOUT_ENUM_ABSTRACT`, or the number of levels
   * between the declaration and the enum abstract that its body reaches.
   *
   * How it stays exact:
   * - Type arguments are never part of an answer. The walk checks the
   *   arguments of each use first, as it always did.
   * - "No" is stored only after an outermost walk ended with "no" and did not
   *   reach the depth limit. Such a walk entered every body that it marked, so
   *   each of those bodies is free of enum abstracts for every use. A "no"
   *   found below a walk that later answers "yes" is not stored, because an
   *   active recursive alias can hide a branch.
   * - "Yes" is stored only for a declaration without type parameters. The body
   *   of a generic declaration is walked with the arguments of one use, and
   *   that use must not answer for another. The stored distance keeps the
   *   depth limit of the walk exact: an answer is not used where the walk
   *   itself could not have reached that enum abstract.
   *
   * Lifetime: `install()` replaces the map, so no answer and no typed value
   * passes to the next request. It holds only strings and integers.
   */
  @:persistent static var declarationAnswers: Map<String, Int> = new Map();

  static inline final ENUM_ABSTRACT = -2;
  static inline final BODY_WITHOUT_ENUM_ABSTRACT = -1;
  static inline final MAX_SOURCE_TYPE_DEPTH = 64;

  /** Depth at which the current walk last found an enum abstract. */
  static var enumAbstractDepth = 0;

  /** True when the current outermost walk stopped at the depth limit. */
  static var walkWasCut = false;

  static inline function enumConstructorKey(owner: EnumType,
      constructor: EnumField): String
    return owner.module + '.' + owner.name + '::' + constructor.name;

  static inline function classFullName(cl: ClassType): String {
    final declaredPath = cl.pack.concat([cl.name]).join('.');
    return (declaredPath == cl.module) ? declaredPath : (cl.module
      + '.'
      + cl.name);
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
    return declaredPath == def.module ? declaredPath : def.module
      + '.'
      + def.name;
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
    return switch unlazy(t) {
      case TType(_, _):
        // Most callers pass a type that is not an alias; make the guard only
        // when one must be followed.
        if (seen == null)
          seen = new Map();
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
   * Why: a type such as `Envelope<Phase>` must keep both parts: the useful
   * `Envelope` name and the closed `Phase` values nested inside it.
   *
   * What/How: the walk checks type arguments before it follows aliases, and it
   * records which named aliases it has already visited so recursive aliases
   * cannot loop forever. If Haxe has not resolved a type yet, or the walk gets
   * unexpectedly deep, this returns `null`; the ordinary type printer then
   * handles the type conservatively instead of guessing.
   *
   * Many fields, arguments and locals name the same abstracts and typedefs.
   * `declarationAnswers` keeps the answer for a declaration's own body during
   * one request, so the walk enters each body about once instead of once for
   * each use. The type arguments of each use are still checked every time.
   */
  static function sourceTypeWithEnumAbstract(t: Type, depth = 0,
      ?seen: Map<String, Bool>): Null<Type> {
    if (depth > MAX_SOURCE_TYPE_DEPTH) {
      walkWasCut = true;
      return null;
    }
    final outermost = seen == null;
    if (seen == null) {
      seen = new Map();
      walkWasCut = false;
    }

    final contains = switch unlazy(t) {
      case TAbstract(reference, params):
        final key = 'A:' + reference.toString();
        var answer = declarationAnswers.get(key);
        var ab: Null<AbstractType> = null;
        if (answer == null) {
          ab = reference.get();
          if (ab.meta.has(':enum')) {
            answer = ENUM_ABSTRACT;
            declarationAnswers.set(key, ENUM_ABSTRACT);
          }
        }
        if (answer == ENUM_ABSTRACT) {
          enumAbstractDepth = depth;
          true;
        } else if (typesContainEnumAbstract(params, depth + 1, seen)) {
          true;
        } else if (seen.exists(key)) {
          false;
        } else {
          seen.set(key, true);
          if (answer == BODY_WITHOUT_ENUM_ABSTRACT) {
            false;
          } else if (answer != null && depth
            + answer <= MAX_SOURCE_TYPE_DEPTH) {
            enumAbstractDepth = depth + answer;
            true;
          } else {
            final declaration = ab ?? reference.get();
            final found = sourceTypeWithEnumAbstract(declaration.type.applyTypeParameters(declaration.params,
              params),
              depth
              + 1, seen) != null;
            if (found && params.length == 0)
              declarationAnswers.set(key, enumAbstractDepth - depth);
            found;
          }
        }
      case TType(reference, params):
        if (typesContainEnumAbstract(params, depth + 1, seen)) {
          true;
        } else {
          final key = 'T:' + reference.toString();
          if (seen.exists(key)) {
            false;
          } else {
            seen.set(key, true);
            final answer = declarationAnswers.get(key);
            if (answer == BODY_WITHOUT_ENUM_ABSTRACT) {
              false;
            } else if (answer != null
              && depth + answer <= MAX_SOURCE_TYPE_DEPTH) {
              enumAbstractDepth = depth + answer;
              true;
            } else {
              final found = sourceTypeWithEnumAbstract(Context.follow(t),
                depth + 1, seen) != null;
              if (found && params.length == 0)
                declarationAnswers.set(key, enumAbstractDepth - depth);
              found;
            }
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
    // A complete walk that found nothing entered the body of every declaration
    // in `seen` and found nothing there. A walk that found something stopped
    // early, so its unfinished declarations stay unanswered.
    if (outermost && !contains && !walkWasCut)
      for (key in seen.keys())
        if (!declarationAnswers.exists(key))
          declarationAnswers.set(key, BODY_WITHOUT_ENUM_ABSTRACT);
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

  /** Captured source witnesses may recover enum values removed by DCE.
   * Ordinary late types must match the ordinary printer, which can emit string.
   */
  public static function enumAbstractLiteralUnionTsType(t: Type,
      capturedSourceType = false): Null<String> {
    final normalized = followTypedefs(unlazy(t));
    switch normalized {
      case TAbstract(_.get() => {pack: [], name: "Null"}, [inner]):
        final innerUnion = enumAbstractLiteralUnionTsType(inner,
          capturedSourceType);
        if (innerUnion == null)
          return null;
        return
          Context.defined('genes.ts.no_null_union') ? innerUnion : (innerUnion
          + ' | null');
      case TType(_.get() => {pack: [], name: "Null"}, [inner]):
        final innerUnion = enumAbstractLiteralUnionTsType(inner,
          capturedSourceType);
        if (innerUnion == null)
          return null;
        return
          Context.defined('genes.ts.no_null_union') ? innerUnion : (innerUnion
          + ' | null');
      case TAbstract(_.get() => ab, _):
        if (!ab.meta.has(':enum'))
          return null;
        // A declaration-backed request may run after DCE removes enum fields.
        // Reuse the literal domain frozen before DCE instead of widening an
        // exact generic call witness to the abstract's primitive backing type.
        final captured = capturedSourceType ? getEnumAbstractTsType(ab) : null;
        if (captured != null)
          return captured;
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
          typeAccessor: _ -> 'X',
          typeParameterName: parameter -> parameter.name
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
    return out.indexOf('|') > -1 || StringTools.startsWith(out, '"')
      || out == 'true' || out == 'false' || ~/^-?[0-9]+(\.[0-9]+)?$/.match(out);
  }

  /** `owner` is `classFullName` of the declaring class, computed once per class. */
  static function storeSig(owner: String, isStatic: Bool, fieldName: String,
      fnType: Type): Void {
    switch unlazy(fnType) {
      case TFun(args, ret):
        sigs.set(keyFor(owner, isStatic, fieldName), {
          args: [
            for (a in args) {
              final nullish = NullishContract.forType(a.t);
              {
                opt: a.opt,
                allowsNull: nullish.haxeAllowsNull,
                preservesUndefined: nullish.preservesUndefined,
                tsType: enumAbstractLiteralUnionTsType(a.t),
                sourceType: sourceTypeWithEnumAbstract(a.t)
              }
            }
          ],
          retTsType: enumAbstractLiteralUnionTsType(ret),
          retSourceType: sourceTypeWithEnumAbstract(ret)
        });
      default:
    }
  }

  /** `owner` is `classFullName` of the declaring class, computed once per class. */
  static function storeFieldType(owner: String, isStatic: Bool,
      field: ClassField): Void {
    final emittedType = NullishContract.forField(field).emittedType;
    final tsType = enumAbstractLiteralUnionTsType(emittedType);
    if (tsType != null)
      fieldTsTypes.set(keyFor(owner, isStatic, field.name), tsType);
    final sourceType = sourceTypeWithEnumAbstract(emittedType);
    if (sourceType != null)
      fieldSourceTypes.set(keyFor(owner, isStatic, field.name), sourceType);
  }

  /**
   * Saves exact field types from anonymous structures owned by a declaration.
   *
   * Named generic aliases are visited through their supplied arguments only.
   * Following their shared body here could let one concrete use overwrite the
   * declaration used by every other type argument.
   */
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

  /** Retains the declared domain, including for later assignments checked by Haxe. */
  static function captureLocal(variable: TVar, includeDirect = false): Void {
    final sourceType = sourceTypeWithEnumAbstract(variable.t);
    if (sourceType == null)
      return;
    if (includeDirect || !isDirectEnumAbstractType(variable.t))
      localSourceTypes.set(variable.id, sourceType);
    else
      directEnumLocalSourceTypes.set(variable.id, sourceType);
  }

  /** Finds declarations even when a warm typed tree has split their initializers. */
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

  /** Captures one class. The other after-typing passes read the same copy. */
  static function captureClass(current: AfterTypingClass): Void {
    final owner = current.ownerKey;
    switch current.constructor() {
      case null:
      case ctor:
        final e = current.body(ctor, false);
        if (e != null) {
          storeSig(owner, false, 'new', e.t);
          captureExpression(e);
        }
    }

    for (f in current.fields()) {
      switch f.kind {
        case FMethod(_):
          storeSig(owner, false, f.name, f.type);
        case FVar(_, _):
          storeFieldType(owner, false, f);
      }
      final expression = current.body(f, false);
      if (expression != null)
        captureExpression(expression);
    }
    for (f in current.statics()) {
      switch f.kind {
        case FMethod(_):
          storeSig(owner, true, f.name, f.type);
        case FVar(_, _):
          storeFieldType(owner, true, f);
      }
      final expression = current.body(f, true);
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
    directEnumLocalSourceTypes = new Map();
    enumAbstractTsTypes = new Map();
    enumConstructorSourceTypes = new Map();
    declarationAnswers = new Map();

    // `onAfterTyping` runs before the JS generator rewrites types (e.g. by
    // following abstracts). Capture declared signatures for TS emission.
    // Classes come from the shared walk; the second function reads the other
    // declaration kinds after it.
    AfterTypingPasses.add(captureClass, types -> {
      for (t in types) {
        switch t {
          case TEnumDecl(ref):
            final owner = ref.get();
            for (constructor in owner.constructs) {
              final sourceType = sourceTypeWithEnumAbstract(constructor.type);
              if (sourceType != null)
                enumConstructorSourceTypes.set(enumConstructorKey(owner,
                  constructor), sourceType);
            }
          case TTypeDecl(ref):
            final definition = ref.get();
            final sourceType = sourceTypeWithEnumAbstract(definition.type);
            if (sourceType != null)
              typedefSourceTypes.set(typedefKey(definition), sourceType);
            // Inspect the declaration as it was authored. In particular, do
            // not follow a named alias such as
            // `ReviewEnvelope = Envelope<ReviewState>` into `Envelope`'s
            // anonymous body. Both declarations then point at the same field
            // positions, and caching the concrete alias there would wrongly
            // rewrite the shared `Envelope<Value>` declaration as
            // `Envelope<ReviewState>`. The collector can still enter an
            // anonymous body owned directly by this typedef and can inspect
            // anonymous types supplied as its own type arguments.
            captureAnonFieldTypes(definition.type);
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

  /**
   * Returns the saved body for one typedef use with its actual type arguments.
   * A mismatched argument count returns `null`, so the caller uses the ordinary
   * compiler type instead of printing unresolved declaration parameters.
   */
  public static function getTypedefSourceType(def: DefType,
      parameters: Array<Type>): Null<Type> {
    final sourceType = typedefSourceTypes.get(typedefKey(def));
    if (sourceType == null)
      return null;
    return
      parameters.length == def.params.length ? sourceType.applyTypeParameters(def.params,
        parameters) : null;
  }

  public static function getLocalSourceType(variable: TVar): Null<Type> {
    return localSourceTypes.get(variable.id);
  }

  /** Payload declarations must agree with source-typed switch locals after abstract erasure. */
  public static function getEnumConstructorSourceType(owner: EnumType,
      constructor: EnumField): Null<Type> {
    return enumConstructorSourceTypes.get(enumConstructorKey(owner,
      constructor));
  }

  /**
   * Retains the declared local domain independently of initializer lowering.
   * Haxe checks later writes against this same type. Request-local recapture
   * also works for warm trees whose initializers have become assignments.
   * Inlining can allocate a new local ID after capture while retaining its
   * typed enum declaration. That surviving type is also an exact witness;
   * names, positions and initializer values are never used to recover it.
   */
  public static function getDirectEnumLocalSourceType(variable: TVar): Null<Type> {
    return
      directEnumLocalSourceTypes.get(variable.id) ?? (isDirectEnumAbstractType(variable.t) ? variable.t : null);
  }

  /** Saved literal spelling used after dead-code elimination removes constants. */
  public static function getEnumAbstractTsType(ab: AbstractType): Null<String> {
    return enumAbstractTsTypes.get(abstractKey(ab));
  }
}
#end
