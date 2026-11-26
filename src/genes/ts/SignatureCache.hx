package genes.ts;

import genes.AfterTypingPasses.AfterTypingClass;
import genes.NullishContract;
import haxe.macro.Context;
import haxe.macro.Expr.Position;
import haxe.macro.Type;
#if macro
import genes.AfterTypingPasses.AfterTypingDeclarations;
import genes.incremental.GenerationChangeSet;
import genes.incremental.GenerationChangeSet.StampedDeclaration;
import genes.incremental.KeptBuckets;
import genes.ts.SignatureFacts.SignatureFact;
#end

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
 *
 * Every request builds the maps (`facts`) again from nothing. The capture of
 * one declaration is a list of `SignatureFact` values, and `put` stores each
 * one.
 *
 * Reuse between requests (only with `-D genes.dev_incremental`, see
 * `visit`): the list of one declaration is also its bucket in
 * `genes.incremental.KeptBuckets`. In a later request, a declaration whose
 * bucket passes the keep rule is not read again; its facts are put back at
 * its place in the declaration order. So the maps are the same as after a
 * capture of every declaration, also when two declarations write one key.
 * Without the define no bucket exists and every declaration is captured.
 *
 * Body holders (only with the define; genes-f8vc.9.27): the capture also
 * keeps, for each local variable and argument of a body, the type
 * parameters of a local function and a declared type that holds an
 * anonymous structure. A macro can write metadata on these after typing,
 * and no fingerprint holds them. Generation code reads them only through
 * `localTypeParameters` and `localDeclaredType`, which record their
 * metadata as answers of the generation replay; `factAnswer` gives the
 * answer again in the next request. See "Body metadata" in
 * `docs/INCREMENTAL_AFTER_TYPING.md`.
 */
class SignatureCache {
  /** The name of this pass in the after-typing report. */
  public static inline final PASS = 'signatureCache';

  /**
   * The maps of this request. `install()` replaces the set, so no fact
   * passes to a later request through it.
   */
  @:persistent static var facts: SignatureFacts = new SignatureFacts();

  /**
   * The kept buckets of this pass: for each declaration the facts of its
   * capture. This is the only state of the pass that a later request reads,
   * and only through the keep rule of `KeptBuckets`. It is `null` until the
   * first eligible request with `-D genes.dev_incremental`.
   */
  @:persistent static var keptBuckets: Null<KeptBuckets<Array<SignatureFact>>> = null;

  /** The list that receives the facts of the declaration that is captured now. */
  static var recording: Null<Array<SignatureFact>> = null;

  /** The key of the declaration that is captured now, for the compare mode. */
  static var capturing: Null<String> = null;

  /**
   * The owner key (`AfterTypingClass.ownerKey`) of the class whose bodies
   * `readClass` reads now: the owner of each body holder that it keeps.
   */
  static var capturingOwner = '';

  /**
   * True when the request has `-D genes.dev_incremental`: only then does
   * `captureBodyHolders` keep the holders that the generation replay checks
   * (genes-f8vc.9.27). Without the define nothing reads them.
   */
  static var keepBodyHolders = false;

  /** Compare mode only: the second set of maps and the differences. */
  static var comparison: Null<SignatureComparison> = null;

  /**
   * How often a walk of this request reached the depth limit, or could not
   * use a remembered answer because of it. Only such a walk can answer
   * differently when `declarationAnswers` holds other answers (see there).
   */
  static var limitEvents = 0;

  /** Declarations of this request whose kept bucket was put back. */
  static var replayed = 0;

  /** True after `captureEverything`: no bucket is read or written any more. */
  static var fullCapture = false;

  /** True when this request asked the bucket store at least once. */
  static var usedBuckets = false;

  /** The declaration lists of this request, for `captureEverything`. */
  static var requestLists: Array<Array<ModuleType>> = [];

  /**
   * Only with `-D genes.dev_incremental`: for each module, the
   * anonymous-field facts that the capture of one of its typedefs wrote at
   * a field declared in another file, as `<kind> <key> <answer>` lines
   * (`foreignAnonFactsOf`). Example: `typedef Props = { > ui.Base.BaseProps,
   * tone: Tone }` in `ui.Card` writes the facts of the fields of
   * `BaseProps`, which `ui/Base.hx` declares. Built again in every request.
   */
  static var foreignAnonFacts: Map<String, Array<String>> = new Map();

  /** The module and the file of the typedef that `readDeclaration` captures now, or `null`. */
  static var anonWriter: Null<{module: String, file: String}> = null;

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
   * How it stays exact, except near the depth limit of 64. There, a cached
   * "yes" can answer a lookup that the old walk cut off. The old walk could
   * mark a declaration as seen and then stop at the limit, so a later use of
   * that declaration answered "no". The reproducer is a chain of 31 typedefs
   * that puts a generic typedef at depth 63. The emitted TypeScript was
   * byte-identical for it.
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
   *   depth limit: an answer is not used where the walk itself could not
   *   have reached that enum abstract. It does not restore a cut that the old
   *   walk made below a seen mark, as described above.
   *
   * Lifetime: `install()` replaces the map, so no answer and no typed value
   * passes to the next request. It holds only strings and integers.
   *
   * Order: the answers are filled in the order of the captures. With reuse
   * between requests (`visit`) only some declarations are captured, so a
   * capture can find fewer answers here than in a request that captures
   * everything. That changes no result while every walk stays inside the
   * depth limit: each stored answer is then a fact of its declaration.
   * `limitEvents` counts the walks that reached the limit; `visit` and
   * `endList` say what happens then.
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
      limitEvents++;
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
            if (answer != null)
              limitEvents++;
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
              if (answer != null)
                limitEvents++;
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

  /**
   * Returns `enumAbstractLiteralUnionTsType(t)` for a capture. Call it
   * directly after `sourceTypeWithEnumAbstract(t)`, and give it that result.
   *
   * Why: the capture asked two questions about the type of every field and
   * argument: "does it contain an enum abstract?" and "is it an enum abstract,
   * so that it has a literal spelling such as `"a" | "b"`?". The first
   * question remembers its answers for one request. The second one did not:
   * it followed the typedefs and read the abstract record of every type
   * again, mostly for `Int`, `String` and `Null<T>`. On the 145-module scale
   * fixture it was the largest part of the signature capture.
   *
   * What: a type has a literal spelling only when it is an enum abstract
   * below `Null` and typedefs. The walk of the first question enters exactly
   * those shapes, so a type that contains no enum abstract has no literal
   * spelling, and this function answers `null` without a second look.
   *
   * The one exception is a walk that stopped at its depth limit of 64
   * levels. It answers "no" for a type that it did not read completely, for
   * example an enum abstract below 65 levels of `Null`. `walkWasCut` reports
   * that, and the old question is then asked as before, so the result is the
   * same string in every case. `tests.signaturecache.EnumAbstractAnswersProbe`
   * checks both sides of the limit.
   */
  static inline function literalUnionAfterWalk(t: Type,
      sourceType: Null<Type>): Null<String>
    return sourceType == null
      && !walkWasCut ? null : enumAbstractLiteralUnionTsType(t);

  /** `owner` is `classFullName` of the declaring class, computed once per class. */
  static function storeSig(owner: String, isStatic: Bool, fieldName: String,
      fnType: Type): Void {
    switch unlazy(fnType) {
      case TFun(args, ret):
        final capturedArgs: Array<CachedArg> = [
          for (a in args) {
            final nullish = NullishContract.forType(a.t);
            final sourceType = sourceTypeWithEnumAbstract(a.t);
            {
              opt: a.opt,
              allowsNull: nullish.haxeAllowsNull,
              preservesUndefined: nullish.preservesUndefined,
              tsType: literalUnionAfterWalk(a.t, sourceType),
              sourceType: sourceType
            }
          }
        ];
        final retSourceType = sourceTypeWithEnumAbstract(ret);
        put(Sig(keyFor(owner, isStatic, fieldName), {
          args: capturedArgs,
          retTsType: literalUnionAfterWalk(ret, retSourceType),
          retSourceType: retSourceType
        }));
      default:
    }
  }

  /** `owner` is `classFullName` of the declaring class, computed once per class. */
  static function storeFieldType(owner: String, isStatic: Bool,
      field: ClassField): Void {
    final emittedType = NullishContract.forField(field).emittedType;
    final sourceType = sourceTypeWithEnumAbstract(emittedType);
    final tsType = literalUnionAfterWalk(emittedType, sourceType);
    if (tsType != null)
      put(FieldTsType(keyFor(owner, isStatic, field.name), tsType));
    if (sourceType != null)
      put(FieldSourceType(keyFor(owner, isStatic, field.name), sourceType));
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
          final sourceType = sourceTypeWithEnumAbstract(fieldType);
          final tsType = literalUnionAfterWalk(fieldType, sourceType);
          if (tsType != null)
            put(AnonFieldTsType(posKey(field.pos), tsType));
          if (sourceType != null)
            put(AnonFieldSourceType(posKey(field.pos), sourceType));
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
    if (keepBodyHolders)
      captureBodyHolders(variable);
    final sourceType = sourceTypeWithEnumAbstract(variable.t);
    if (sourceType == null)
      return;
    if (includeDirect || !isDirectEnumAbstractType(variable.t))
      put(LocalSourceType(variable.id, sourceType));
    else
      put(DirectEnumLocalSourceType(variable.id, sourceType));
  }

  /**
   * Keeps the metadata holders that one local variable or argument reaches
   * (genes-f8vc.9.27): the type parameters of a local function, and a
   * declared type that holds an anonymous structure.
   *
   * Why: a macro can write metadata on such a holder after typing, in a
   * request in which Haxe does not type the body again, and the printed
   * TypeScript follows it. Example: `@:ts.type("string")` on the field `lv`
   * of `function inner<L:{lv: Int}>(x: L)` changes `lv: number` into
   * `lv: string`. No declaration lists these holders, so no fingerprint and
   * no metadata comparison sees the change. The kept values are references:
   * `localTypeParameters` and `localDeclaredType` read their metadata as it
   * is in the request that asks.
   */
  static function captureBodyHolders(variable: TVar): Void {
    final owner = capturingOwner;
    final extra = variable.extra;
    if (extra != null && extra.params.length > 0)
      put(LocalTypeParameters(owner, variable.id, extra.params));
    if (genes.incremental.ModuleFingerprint.holdsStructure(variable.t))
      put(LocalDeclaredType(owner, variable.id, variable.t));
  }

  /** Finds declarations even when a warm typed tree has split their initializers. */
  static function captureExpression(expression: TypedExpr): Void {
    eachLocal(expression,
      (variable, argument) -> captureLocal(variable, argument));
  }

  /**
   * Calls `visit` for each local variable, function argument and catch
   * variable that `expression` declares, in walk order; the flag is `true`
   * for a function argument. `captureExpression` and the body holders of a
   * class initializer share this one walk.
   */
  static function eachLocal(expression: TypedExpr,
      visit: (variable: TVar, argument: Bool) -> Void): Void {
    function walk(e: TypedExpr): Void {
      switch e.expr {
        case TVar(variable, _):
          visit(variable, false);
        case TFunction(fn):
          for (arg in fn.args)
            visit(arg.v, true);
        case TTry(_, catches):
          for (entry in catches)
            visit(entry.v, false);
        default:
      }
      haxe.macro.TypedExprTools.iter(e, walk);
    }
    walk(expression);
  }

  /**
   * Captures one class. The other after-typing passes read the same copy.
   *
   * Extern classes are captured here too, and not later on the first
   * `getSig` call for one of them. After this walk, Haxe 4.3.7 changes the
   * values that such a late capture would read: `@:native` replaces the path
   * of a class and the name of a field (`js.lib.Promise.catchError` becomes
   * `catch`), and dead-code elimination removes the unused fields of `Array`
   * and `Math`. A late capture would store entries under other keys than
   * this one does, so a lookup could find a signature that it does not find
   * today.
   */
  static function captureClass(current: AfterTypingClass): Void {
    final stamp = current.stamp;
    final declaration = current.declaration;
    if (stamp == null || declaration == null)
      readClass(current);
    else
      visit(stamp, declaration, current.memberList, () -> readClass(current));
  }

  /** Reads every fact of one class and stores it with `put`. */
  static function readClass(current: AfterTypingClass): Void {
    final owner = current.ownerKey;
    capturingOwner = owner;
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
    // The class initializer (`static function __init__`) is a body too: the
    // dependency walk visits it and the printer prints it, so its holders
    // must be kept like those of a field (review of genes-ts #258). Only the
    // holders: its locals never had source-type facts, and adding them would
    // change the printed types of a build without the define.
    final init = current.type.init;
    if (keepBodyHolders && init != null)
      eachLocal(init, (variable, _) -> captureBodyHolders(variable));
  }

  static function captureEnumAbstract(reference: Ref<AbstractType>): Void {
    final ab = reference.get();
    if (!ab.meta.has(':enum'))
      return;
    final sourceType = TAbstract(reference, [for (param in ab.params) param.t]);
    final tsType = enumAbstractLiteralUnionTsType(sourceType);
    if (tsType != null)
      put(EnumAbstractTsType(abstractKey(ab), tsType));
  }

  /**
   * Reads every fact of one enum, typedef or abstract and stores it with
   * `put`. Classes go through `readClass`.
   */
  static function readDeclaration(type: ModuleType): Void {
    switch type {
      case TEnumDecl(ref):
        final owner = ref.get();
        for (constructor in owner.constructs) {
          final sourceType = sourceTypeWithEnumAbstract(constructor.type);
          if (sourceType != null)
            put(EnumConstructorSourceType(enumConstructorKey(owner,
              constructor), sourceType));
        }
      case TTypeDecl(ref):
        final definition = ref.get();
        final sourceType = sourceTypeWithEnumAbstract(definition.type);
        if (sourceType != null)
          put(TypedefSourceType(typedefKey(definition), sourceType));
        // Inspect the declaration as it was authored. In particular, do
        // not follow a named alias such as
        // `ReviewEnvelope = Envelope<ReviewState>` into `Envelope`'s
        // anonymous body. Both declarations then point at the same field
        // positions, and caching the concrete alias there would wrongly
        // rewrite the shared `Envelope<Value>` declaration as
        // `Envelope<ReviewState>`. The collector can still enter an
        // anonymous body owned directly by this typedef and can inspect
        // anonymous types supplied as its own type arguments.
        anonWriter = writerOf(definition);
        captureAnonFieldTypes(definition.type);
        anonWriter = null;
      case TAbstract(ref):
        captureEnumAbstract(ref);
      case TClassDecl(_):
    }
  }

  /**
   * Stores one fact of the declaration that is captured now. When a bucket
   * is recorded for that declaration, the fact also goes into the bucket.
   */
  static function put(fact: SignatureFact): Void {
    facts.put(fact);
    final writer = anonWriter;
    if (writer != null)
      noteForeignFact(writer, fact);
    final log = recording;
    if (log != null)
      log.push(fact);
    final check = comparison;
    final owner = capturing;
    if (check != null && owner != null)
      check.noteNew(owner, fact);
  }

  /**
   * Captures one declaration of a request that uses the incremental path
   * (`-D genes.dev_incremental`), or puts its kept bucket back.
   *
   * `capture` reads the declaration and stores its facts with `put`.
   * `members` returns the member list of a class, or `null` for another
   * kind. What happens depends on the descriptor field `afterTyping`:
   *
   * - `reuse`: when the bucket passes the keep rule, its facts are put back
   *   and `capture` does not run. Else `capture` runs and its facts become
   *   the new bucket.
   * - `measure` (the default): `capture` always runs. The keep rule is
   *   decided and counted. A bucket is written only when none was kept, so
   *   a kept bucket stays the read of the request that made it.
   * - `compare`: as `measure`, and the facts that `reuse` would use go into
   *   a second set of maps (`SignatureComparison`).
   *
   * A capture that reached the depth limit of the enum-abstract walk writes
   * no bucket. Only such a capture can depend on which other declarations
   * were captured before it in the request (`declarationAnswers`), so its
   * facts are valid for this request only.
   *
   * Example: after an edit of `app/Leaf.hx`, `visit` runs `capture` for the
   * declarations of `app.Leaf` and puts the buckets of the other 2,000
   * declarations back.
   */
  static function visit(stamp: StampedDeclaration, declaration: ModuleType,
      members: Void->Null<String>, capture: Void->Void): Void {
    if (fullCapture) {
      capture();
      return;
    }
    final store = buckets();
    final counts = store.counts();
    usedBuckets = true;
    final mode = GenerationChangeSet.reuse();
    if (mode == Compare && comparison == null) {
      comparison = new SignatureComparison(counts);
      Context.onAfterGenerate(reportComparison);
    }
    final check = comparison;
    final found = store.kept(stamp, declaration, members);
    final started = haxe.Timer.stamp();
    if (found != null) {
      if (mode == Reuse) {
        var writer: Null<{module: String, file: String}> = null;
        for (fact in found.value) {
          facts.put(fact);
          switch fact {
            case AnonFieldTsType(_, _) | AnonFieldSourceType(_, _):
              if (writer == null)
                writer = switch declaration {
                  case TTypeDecl(ref): writerOf(ref.get());
                  default: null;
                };
              if (writer != null)
                noteForeignFact(writer, fact);
            default:
          }
        }
        replayed++;
        counts.countSkipped();
        counts.countReplay(haxe.Timer.stamp() - started);
        return;
      }
      capturing = stamp.key;
      capture();
      capturing = null;
      counts.countWorked(haxe.Timer.stamp() - started);
      if (check != null)
        check.replay(stamp.key, found.value, found.firstRead);
      return;
    }
    final log: Array<SignatureFact> = [];
    final eventsBefore = limitEvents;
    recording = log;
    capturing = stamp.key;
    capture();
    capturing = null;
    recording = null;
    counts.countWorked(haxe.Timer.stamp() - started);
    if (limitEvents != eventsBefore)
      store.forget(stamp);
    else
      store.write(stamp, declaration, members(), log);
    if (check != null)
      check.replay(stamp.key, log, false);
  }

  /** Returns the bucket store of this pass; makes it at the first call. */
  static function buckets(): KeptBuckets<Array<SignatureFact>> {
    final known = keptBuckets;
    if (known != null)
      return known;
    final created = new KeptBuckets(PASS);
    keptBuckets = created;
    return created;
  }

  /**
   * Ends one declaration list of a request that uses the incremental path.
   *
   * With reuse on, it checks the one case in which kept buckets and new
   * captures together can differ from a capture of everything: a new
   * capture reached the depth limit of the enum-abstract walk
   * (`limitEvents`) in a request that put a bucket back. Such a walk can
   * answer differently when fewer declarations were captured before it.
   * Then `captureEverything` reads every declaration of the request again,
   * in order, as a request without reuse does.
   */
  static function endList(types: Array<ModuleType>): Void {
    requestLists.push(types);
    if (!usedBuckets)
      return;
    if (!fullCapture && replayed > 0 && limitEvents > 0)
      captureEverything();
    buckets().endRequest();
  }

  /**
   * Drops the facts of this request and captures every declaration again,
   * list by list, classes first: the order of a request without reuse.
   * After it, the request reads and writes no bucket.
   */
  static function captureEverything(): Void {
    fullCapture = true;
    facts = new SignatureFacts();
    foreignAnonFacts = new Map();
    declarationAnswers = new Map();
    for (types in requestLists) {
      for (type in types)
        switch type {
          case TClassDecl(reference):
            readClass(new AfterTypingClass(reference.get()));
          default:
        }
      for (type in types)
        readDeclaration(type);
    }
    buckets().counts()
      .noteFullWork('a type is nested deeper than $MAX_SOURCE_TYPE_DEPTH '
        + 'levels: its capture can depend on the declarations that were '
        + 'captured before it, so every declaration was captured again');
  }

  /**
   * Compare mode: writes the report again after generation, with the
   * compared questions and the differences, and warns when a kept bucket
   * answered wrongly.
   */
  static function reportComparison(): Void {
    final failures = buckets().counts().compareFailureTotal();
    GenerationChangeSet.writeReport();
    if (failures > 0)
      Context.warning('[GENES-INCREMENTAL-COMPARE-001] $failures answers of '
        + 'kept SignatureCache buckets differ from a new capture. The '
        + 'output of this request uses the new capture. See '
        + '"compareFailures" in the after-typing report.',
        Context.currentPos());
  }

  public static function install(): Void {
    // Reset for each compilation.
    facts = new SignatureFacts();
    declarationAnswers = new Map();
    recording = null;
    capturing = null;
    capturingOwner = '';
    keepBodyHolders = Context.defined('genes.dev_incremental');
    comparison = null;
    limitEvents = 0;
    replayed = 0;
    fullCapture = false;
    usedBuckets = false;
    requestLists = [];
    foreignAnonFacts = new Map();
    anonWriter = null;

    // `onAfterTyping` runs before the JS generator rewrites types (e.g. by
    // following abstracts). Capture declared signatures for TS emission.
    // Classes come from the shared walk; the second function reads the other
    // declaration kinds after it.
    AfterTypingPasses.add('signatureCache', captureClass, captureDeclarations);
  }

  /** Captures the enums, typedefs and abstracts of one declaration list. */
  static function captureDeclarations(declarations: AfterTypingDeclarations): Void {
    final stamps = declarations.stamps;
    for (index => type in declarations.types) {
      switch type {
        case TClassDecl(_):
        default:
          final stamp = stamps == null ? null : stamps[index];
          if (stamp == null)
            readDeclaration(type);
          else
            visit(stamp, type, noMembers, () -> readDeclaration(type));
      }
    }
    if (stamps != null)
      endList(declarations.types);
  }

  /** The member list of a declaration that is not a class: none. */
  static function noMembers(): Null<String> {
    return null;
  }

  public static function getSig(cl: ClassType, isStatic: Bool,
      fieldName: String): Null<CachedSig> {
    final key = keyFor(classFullName(cl), isStatic, fieldName);
    final answer = facts.sigs.get(key);
    final check = comparison;
    if (check != null)
      check.sigs(key, check.kept.sigs.get(key), answer);
    return answer;
  }

  public static function getFieldTsType(cl: ClassType, isStatic: Bool,
      fieldName: String): Null<String> {
    final key = keyFor(classFullName(cl), isStatic, fieldName);
    final answer = facts.fieldTsTypes.get(key);
    final check = comparison;
    if (check != null)
      check.texts('fieldTsType', key, check.kept.fieldTsTypes.get(key), answer);
    return answer;
  }

  public static function getAnonFieldTsType(pos: Position): Null<String> {
    final key = posKey(pos);
    final answer = facts.anonFieldTsTypes.get(key);
    final check = comparison;
    if (check != null)
      check.texts('anonFieldTsType', key,
        check.kept.anonFieldTsTypes.get(key), answer);
    // The capture of another declaration can write this fact; see
    // `IncrementalShadow.recordFact`. Without it this does nothing.
    if (genes.incremental.IncrementalShadow.recording())
      genes.incremental.IncrementalShadow.recordFact(ANON_TS, key,
        factAnswer(ANON_TS, key));
    return answer;
  }

  public static function getFieldSourceType(cl: ClassType, isStatic: Bool,
      fieldName: String): Null<Type> {
    final key = keyFor(classFullName(cl), isStatic, fieldName);
    final answer = facts.fieldSourceTypes.get(key);
    final check = comparison;
    if (check != null)
      check.types('fieldSourceType', key,
        check.kept.fieldSourceTypes.get(key), answer);
    return answer;
  }

  public static function getAnonFieldSourceType(pos: Position): Null<Type> {
    final key = posKey(pos);
    final answer = facts.anonFieldSourceTypes.get(key);
    final check = comparison;
    if (check != null)
      check.types('anonFieldSourceType', key,
        check.kept.anonFieldSourceTypes.get(key), answer);
    if (genes.incremental.IncrementalShadow.recording())
      genes.incremental.IncrementalShadow.recordFact(ANON_SOURCE, key,
        factAnswer(ANON_SOURCE, key));
    return answer;
  }

  /**
   * Returns the anonymous-field facts that the typedefs of `module` wrote
   * in this request at a field declared in another file, sorted, each line
   * once: `anonTs <key> +<text>` or `anonSource <key> +<type>` (the answer
   * text of `factAnswer`). Empty without `-D genes.dev_incremental`.
   *
   * Why (genes-f8vc.14.27): another module prints those fields, and a
   * module request prints only the edited module. Module records keep these
   * facts (`ModuleRecord.foreignFacts`), and a module request whose edited
   * module writes other ones is refused (`foreign-facts-changed`). Example:
   * `typedef First = {> Frame<Tone>, extra: Int}` becomes `{> Frame2<Tone>,
   * extra: Int}`: the signature stays, but a full build prints the file of
   * `Frame` again.
   */
  public static function foreignAnonFactsOf(module: String): Array<String> {
    final lines = foreignAnonFacts.get(module);
    if (lines == null)
      return [];
    final unique = new Map<String, Bool>();
    for (line in lines)
      unique.set(line, true);
    final sorted = [for (line in unique.keys()) line];
    sorted.sort((left, right) -> left < right ? -1 : left > right ? 1 : 0);
    return sorted;
  }

  /** Returns the module and the source file of a typedef, for `noteForeignFact`. */
  static function writerOf(definition: DefType): {module: String, file: String} {
    return {
      module: definition.module,
      file: Context.getPosInfos(definition.pos).file
    };
  }

  /**
   * Notes one fact of the typedef `writer` in `foreignAnonFacts` when it is
   * an anonymous-field fact at a field of another file. Only with
   * `-D genes.dev_incremental`.
   */
  static function noteForeignFact(writer: {module: String, file: String},
      fact: SignatureFact): Void {
    if (!keepBodyHolders)
      return;
    final line = switch fact {
      case AnonFieldTsType(key, text) if (keyFile(key) != writer.file):
        '$ANON_TS $key +$text';
      case AnonFieldSourceType(key, type) if (keyFile(key) != writer.file):
        '$ANON_SOURCE $key +${haxe.macro.TypeTools.toString(type)}';
      default:
        null;
    }
    if (line == null)
      return;
    final lines = foreignAnonFacts.get(writer.module);
    if (lines == null)
      foreignAnonFacts.set(writer.module, [line]);
    else
      lines.push(line);
  }

  /** Returns the file of a `posKey` (`<file>:<min>:<max>`). */
  static function keyFile(key: String): String {
    final last = key.lastIndexOf(':');
    final middle = last <= 0 ? -1 : key.lastIndexOf(':', last - 1);
    return middle < 0 ? key : key.substr(0, middle);
  }

  /** The answer kind of `getAnonFieldTsType` for the incremental generator. */
  public static inline final ANON_TS = 'anonTs';

  /** The answer kind of `getAnonFieldSourceType` for the incremental generator. */
  public static inline final ANON_SOURCE = 'anonSource';

  /** The answer kind of `localTypeParameters` for the incremental generator. */
  public static inline final BODY_PARAMS = 'bodyParams';

  /** The answer kind of `localDeclaredType` for the incremental generator. */
  public static inline final BODY_TYPE = 'bodyType';

  /**
   * Returns the text of one recorded fact of this request, as the
   * incremental generator records and checks it. `kind` is one of the four
   * kinds of this class:
   *
   * - `ANON_TS`, `ANON_SOURCE`: `key` is the `posKey` of a field of an
   *   anonymous structure. `-` when there is no fact, else `+` and the
   *   TypeScript text (`ANON_TS`) or the Haxe type text (`ANON_SOURCE`,
   *   `TypeTools.toString`, the text that `SignatureComparison` also
   *   compares).
   * - `BODY_PARAMS`, `BODY_TYPE` (genes-f8vc.9.27): `key` is
   *   `<owner>#<variable id>` (`bodyKey`). `+` and the metadata text of the
   *   kept holder, read now: `ModuleFingerprint.constraintText` of the type
   *   parameters of a local function, or `ModuleFingerprint.anonymousText`
   *   of the declared type of a local variable or argument. `?` when this
   *   request keeps no such holder for that owner.
   *
   * Why: a replay checks before emission that each fact that a clean module
   * read is the same now (review of #244, M2; S3 of the review of #246). It
   * reads the facts directly and runs no comparison of `afterTyping:
   * "compare"`. An unknown kind gives `?`, which no recorded answer equals.
   */
  public static function factAnswer(kind: String, key: String): String {
    switch kind {
      case ANON_TS:
        final text = facts.anonFieldTsTypes.get(key);
        return text == null ? '-' : '+' + text;
      case ANON_SOURCE:
        final type = facts.anonFieldSourceTypes.get(key);
        return type == null ? '-' : '+' + haxe.macro.TypeTools.toString(type);
      case BODY_PARAMS | BODY_TYPE:
        final split = key.lastIndexOf('#');
        final id = split < 0 ? null : Std.parseInt(key.substr(split + 1));
        if (id == null)
          return MISSING_HOLDER;
        final text = bodyHolderText(facts, kind, id, key.substr(0, split));
        return text == null ? MISSING_HOLDER : '+' + text;
      default:
        return MISSING_HOLDER;
    }
  }

  /** The answer of `factAnswer` when no holder answers; no recorded answer equals it. */
  static inline final MISSING_HOLDER = '?';

  /**
   * The answer that `localTypeParameters` records for a local function that
   * this request keeps no holder for (`GenerationCache.UNKNOWN_ANSWER`).
   * Rule 11 of `GenerationCache` keeps the module that recorded it out of
   * the clean set, so that module is printed in each request while every
   * other clean module can still be replayed.
   */
  static inline final UNKNOWN_HOLDER = genes.incremental.GenerationCache.UNKNOWN_ANSWER;

  /** Returns the key of a body holder: the owner class and the variable id. */
  static inline function bodyKey(owner: String, id: Int): String
    return '$owner#$id';

  /**
   * Returns the metadata text of the body holder of `kind` for the variable
   * `id` in `set`, read now, or `null` when `set` has no such holder or
   * another class owns it. `owner` `null` accepts any owner.
   */
  static function bodyHolderText(set: SignatureFacts, kind: String, id: Int,
      owner: Null<String>): Null<String> {
    if (kind == BODY_PARAMS) {
      final holder = set.localTypeParameters.get(id);
      return holder == null
        || (owner != null && holder.owner != owner) ? null : genes.incremental.ModuleFingerprint.constraintText(holder.value);
    }
    final holder = set.localDeclaredTypes.get(id);
    return holder == null
      || (owner != null && holder.owner != owner) ? null : genes.incremental.ModuleFingerprint.anonymousText(holder.value);
  }

  /**
   * Returns the type parameters that the local function `variable` declares
   * (`TVar.extra`), or an empty list. This is the one way in which
   * generation code reads them (`CleanRuleProbe` fails on any other read of
   * `.extra`).
   *
   * Why (genes-f8vc.9.27, S3 of the review of genes-ts #246): TypeScript
   * prints each parameter with its `@:ts.type` and the structures of its
   * constraints, and a macro can change that metadata after typing without a
   * new typing of the body. So, while the incremental generator records,
   * this records the metadata text of the parameters (`BODY_PARAMS`) as an
   * answer of the module that prints the function. `planReplay` asks
   * `factAnswer` again in the next request and generates in full when the
   * text differs. The text comes from the holder that this pass kept
   * (`LocalTypeParameters`), so the recorded and the checked answer read
   * the same references. A local function without a kept holder records
   * `UNKNOWN_HOLDER`, and its module is never clean (rule 11 of
   * `GenerationCache`): it is printed in each request.
   *
   * Example: `function inner<L:{lv: Int}>(x: L)` records ` <L.0 0.lv
   * @:ts.type("string")` after a macro marked `lv`, where it recorded an
   * empty text before.
   */
  public static function localTypeParameters(variable: TVar): Array<TypeParameter> {
    final extra = variable.extra;
    if (extra == null || extra.params.length == 0)
      return [];
    askBodyHolder(BODY_PARAMS, variable.id, 'localTypeParameters');
    return extra.params;
  }

  /**
   * Returns the declared type of the local variable or argument `variable`
   * for a reader that walks its structures: today the dependency walk of
   * `DependencyPlanBuilder`, which visits every local variable and argument
   * of every body that a module prints.
   *
   * Why (genes-f8vc.9.27): the printer prints the structures of that type
   * with the metadata of their fields, and a macro can change it after
   * typing without a new typing of the body. So, while the incremental
   * generator records, this records the metadata text of the structures
   * (`BODY_TYPE`) when this pass kept the type (`LocalDeclaredType`; only a
   * type that holds a structure). A variable without a kept type is one
   * that Haxe made after the capture (for example a loop temporary); its
   * structures are those of the expression that it holds, a limit of this
   * check (see "Body metadata" in `docs/INCREMENTAL_AFTER_TYPING.md`).
   */
  public static function localDeclaredType(variable: TVar): Type {
    askBodyHolder(BODY_TYPE, variable.id, 'localDeclaredType');
    return variable.t;
  }

  /**
   * Records the answer of one body holder of this request for the module
   * whose clock runs, and compares the kept answer with a new capture in
   * compare mode (`afterTyping: "compare"`). A `BODY_PARAMS` question
   * without a kept holder records `UNKNOWN_HOLDER`; a `BODY_TYPE` question
   * without one records nothing (see `localDeclaredType`).
   */
  static function askBodyHolder(kind: String, id: Int, query: String): Void {
    final check = comparison;
    if (check != null) {
      final keptText = bodyHolderText(check.kept, kind, id, null);
      final newText = bodyHolderText(facts, kind, id, null);
      if (keptText != null || newText != null)
        check.localAnswers(query, id, keptText, newText);
    }
    if (!genes.incremental.IncrementalShadow.recording())
      return;
    final owner = bodyHolderOwner(kind, id);
    if (owner == null) {
      if (kind == BODY_PARAMS)
        genes.incremental.IncrementalShadow.recordFact(kind, bodyKey('', id),
          UNKNOWN_HOLDER);
      return;
    }
    final key = bodyKey(owner, id);
    genes.incremental.IncrementalShadow.recordFact(kind, key,
      factAnswer(kind, key));
  }

  /** Returns the owner of the kept body holder of `kind` for the variable `id`, or `null`. */
  static function bodyHolderOwner(kind: String, id: Int): Null<String> {
    if (kind == BODY_PARAMS) {
      final holder = facts.localTypeParameters.get(id);
      return holder == null ? null : holder.owner;
    }
    final holder = facts.localDeclaredTypes.get(id);
    return holder == null ? null : holder.owner;
  }

  /**
   * Returns the saved body for one typedef use with its actual type arguments.
   * A mismatched argument count returns `null`, so the caller uses the ordinary
   * compiler type instead of printing unresolved declaration parameters.
   */
  public static function getTypedefSourceType(def: DefType,
      parameters: Array<Type>): Null<Type> {
    final key = typedefKey(def);
    final sourceType = facts.typedefSourceTypes.get(key);
    final check = comparison;
    if (check != null)
      check.types('typedefSourceType', key,
        check.kept.typedefSourceTypes.get(key), sourceType);
    if (sourceType == null)
      return null;
    return
      parameters.length == def.params.length ? sourceType.applyTypeParameters(def.params,
        parameters) : null;
  }

  public static function getLocalSourceType(variable: TVar): Null<Type> {
    final answer = facts.localSourceTypes.get(variable.id);
    final check = comparison;
    if (check != null)
      check.locals('localSourceType', variable.id,
        check.kept.localSourceTypes.get(variable.id), answer);
    return answer;
  }

  /** Payload declarations must agree with source-typed switch locals after abstract erasure. */
  public static function getEnumConstructorSourceType(owner: EnumType,
      constructor: EnumField): Null<Type> {
    final key = enumConstructorKey(owner, constructor);
    final answer = facts.enumConstructorSourceTypes.get(key);
    final check = comparison;
    if (check != null)
      check.types('enumConstructorSourceType', key,
        check.kept.enumConstructorSourceTypes.get(key), answer);
    return answer;
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
    final captured = facts.directEnumLocalSourceTypes.get(variable.id);
    final check = comparison;
    if (captured != null && check == null)
      return captured;
    final declared = isDirectEnumAbstractType(variable.t) ? variable.t : null;
    if (check != null)
      check.locals('directEnumLocalSourceType', variable.id,
        check.kept.directEnumLocalSourceTypes.get(variable.id) ?? declared,
        captured ?? declared);
    return captured ?? declared;
  }

  /** Saved literal spelling used after dead-code elimination removes constants. */
  public static function getEnumAbstractTsType(ab: AbstractType): Null<String> {
    final key = abstractKey(ab);
    final answer = facts.enumAbstractTsTypes.get(key);
    final check = comparison;
    if (check != null)
      check.texts('enumAbstractTsType', key,
        check.kept.enumAbstractTsTypes.get(key), answer);
    return answer;
  }
}
#end
