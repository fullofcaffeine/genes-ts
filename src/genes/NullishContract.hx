package genes;

import haxe.macro.Context;
import haxe.macro.Type;

/**
 * Identifies the semantic position whose absence rules are being planned.
 *
 * Why: the same Haxe `Type` can participate in materially different runtime
 * contracts. `Null<T>` is a value-level nullable union, an optional property is
 * physically absent as JavaScript `undefined`, a Haxe optional parameter is
 * observed as `null` after defaulting, `Map.get` reports Haxe absence as
 * `null`, and an iterator completion record uses JavaScript `undefined`.
 * Collapsing those positions into a printer-local `allowsNull` boolean caused
 * the TS implementation emitter, classic emitter, and declaration emitter to
 * make related decisions independently.
 *
 * What/How: `NullishContract` factories select one of these positions before a
 * target printer chooses syntax. The enum is deliberately small: it describes
 * established Haxe/JavaScript meaning, not every expression form and not a
 * target-specific IR.
 */
enum NullishSite {
  Value;
  OptionalProperty;
  OptionalParameter;
  NativeMapRead;
  IteratorCompletion;
}

/**
 * Describes the value observed when a semantic position has no payload.
 *
 * `NoMissingValue` means the position itself adds no absence beyond its
 * declared type. The other cases are facts consumed by printers and runtime
 * bridges; their spelling (`null`, `undefined`, a default initializer, or a
 * declaration union) remains target-specific.
 */
enum NullishMissingValue {
  NoMissingValue;
  MissingAsNull;
  MissingAsUndefined;
}

private typedef NullishTypeFacts = {
  final haxeAllowsNull: Bool;
  final explicitUndefined: Bool;
  final unknownBoundary: Bool;
  final dynamicBoundary: Bool;
}

/**
 * Immutable semantic facts for Haxe null and JavaScript absence boundaries.
 *
 * Why
 * ----
 * Haxe's typed AST uses several overlapping representations:
 *
 * - `Null<T>` means a Haxe-visible nullable value;
 * - `genes.ts.Undefinable<T>` deliberately means `T | undefined` at a host
 *   boundary and must not silently acquire `null`;
 * - `genes.ts.Unknown` preserves either host sentinel until guarded;
 * - `@:optional` properties are physically missing as `undefined`, even when
 *   Haxe source reads them through a `Null<T>` wrapper;
 * - optional parameters, native map reads, and iterator completion each have
 *   their own absence contract.
 *
 * Previously these facts were rediscovered in `ExprEmitter`, `TypeEmitter`,
 * `SignatureCache`, and `TsModuleEmitter`. Small differences were enough for an
 * optional `Undefinable<T>` read to become `?? null`, contradicting its public
 * TypeScript type while still passing ordinary `tsc` checks.
 *
 * What
 * ----
 * A contract records both the source-facing type and the type a declaration
 * printer should render after position-specific normalization. It separately
 * records Haxe nullability, explicit JavaScript undefined, untrusted/dynamic
 * boundaries, syntactic omission, the observed missing value, and whether a
 * read or write needs a sentinel conversion.
 *
 * How
 * ---
 * Factory methods inspect typed Haxe `Type` values before target printing.
 * Typedefs and lazy types are followed, but abstracts are preserved long
 * enough to recognize `Undefinable` and `Unknown`. An optional field removes
 * Haxe's synthetic outer `Null` only when `@:ts.optional` or an explicit
 * `Undefinable` contract says the TypeScript value excludes `null`. Target
 * emitters consume these booleans/enums and remain responsible for concrete
 * syntax and source-map positions.
 *
 * This is intentionally not a universal type IR. It models only nullish facts
 * whose meaning must stay shared between classic JS, TS source, and `.d.ts`
 * output.
 */
final class NullishContract {
  public final site: NullishSite;
  public final declaredType: Type;
  public final emittedType: Type;
  public final valueType: Type;
  public final haxeAllowsNull: Bool;
  public final emittedAllowsNull: Bool;
  public final explicitUndefined: Bool;
  public final unknownBoundary: Bool;
  public final dynamicBoundary: Bool;
  public final mayBeOmitted: Bool;
  public final missingValue: NullishMissingValue;
  public final emitOptionalSyntax: Bool;
  public final normalizeUndefinedReadToNull: Bool;
  public final normalizeNullWriteToUndefined: Bool;

  /**
   * True when raw JavaScript `undefined` is part of an intentional boundary.
   *
   * Unknown values preserve the sentinel even though they do not spell an
   * explicit union: narrowing must be able to distinguish `undefined` from
   * `null`. `Dynamic` is excluded because ordinary Haxe dynamic/null behavior
   * historically normalizes absence rather than promising that distinction.
   */
  public var preservesUndefined(get, never): Bool;

  inline function get_preservesUndefined(): Bool {
    return explicitUndefined || unknownBoundary;
  }

  /** Returns whether this position has a semantic absence beyond its payload. */
  public var hasMissingValue(get, never): Bool;

  inline function get_hasMissingValue(): Bool {
    return missingValue != NoMissingValue;
  }

  /**
   * True when a TypeScript function implementation needs `= null` rather than
   * `?` to make an omitted Haxe-nullable argument observable as Haxe `null`.
   * Declaration signatures remain optional either way.
   */
  public var usesNullDefault(get, never): Bool;

  inline function get_usesNullDefault(): Bool {
    return site == OptionalParameter && missingValue == MissingAsNull;
  }

  /**
   * True when a target property type must add an explicit `undefined` arm.
   *
   * `@:ts.optional` lowering currently writes an own property normalized with
   * `?? undefined`. Under TypeScript `exactOptionalPropertyTypes`, `field?: T`
   * alone permits omission but rejects that emitted own-undefined value. An
   * explicit `Undefinable<T>` already renders its own union, so only the
   * metadata projection needs an additional arm.
   */
  public var needsUndefinedTypeProjection(get, never): Bool;

  inline function get_needsUndefinedTypeProjection(): Bool {
    return normalizeNullWriteToUndefined
      && !explicitUndefined && !unknownBoundary;
  }

  /**
   * Returns true when a raw host `undefined` should become Haxe `null`.
   *
   * Printers use this for raw syntax and host-library reads. An explicit
   * `Undefinable`/`Unknown` boundary wins over an enclosing `Null` wrapper so a
   * meaningful JavaScript sentinel is never erased accidentally.
   */
  public inline function shouldNormalizeRawUndefinedToNull(): Bool {
    return haxeAllowsNull && !preservesUndefined;
  }

  function new(site: NullishSite, declaredType: Type,
      emittedType: Type, haxeAllowsNull: Bool, emittedAllowsNull: Bool,
      explicitUndefined: Bool, unknownBoundary: Bool, dynamicBoundary: Bool,
      mayBeOmitted: Bool, missingValue: NullishMissingValue,
      emitOptionalSyntax: Bool, normalizeUndefinedReadToNull: Bool,
      normalizeNullWriteToUndefined: Bool) {
    this.site = site;
    this.declaredType = declaredType;
    this.emittedType = emittedType;
    this.valueType = stripHaxeNull(declaredType);
    this.haxeAllowsNull = haxeAllowsNull;
    this.emittedAllowsNull = emittedAllowsNull;
    this.explicitUndefined = explicitUndefined;
    this.unknownBoundary = unknownBoundary;
    this.dynamicBoundary = dynamicBoundary;
    this.mayBeOmitted = mayBeOmitted;
    this.missingValue = missingValue;
    this.emitOptionalSyntax = emitOptionalSyntax;
    this.normalizeUndefinedReadToNull = normalizeUndefinedReadToNull;
    this.normalizeNullWriteToUndefined = normalizeNullWriteToUndefined;
  }

  /** Plans an ordinary typed value without adding position-specific absence. */
  public static function forType(type: Type): NullishContract {
    final facts = classify(type);
    return new NullishContract(Value, type, type, facts.haxeAllowsNull,
      facts.haxeAllowsNull, facts.explicitUndefined, facts.unknownBoundary,
      facts.dynamicBoundary, false, NoMissingValue, false, false, false);
  }

  /**
   * Plans an anonymous/class field's source and TypeScript declaration shape.
   *
   * Ordinary Haxe optional fields retain their `T | null` value type and
   * normalize missing reads to Haxe `null`. `@:ts.optional` fields project as
   * `field?: T | undefined`: nullable writes become an explicit `undefined`
   * while reads normalize back to Haxe `null`. Optional `Undefinable<T>` fields
   * use the same surface shape but preserve `undefined` on reads.
   */
  public static function forField(field: ClassField): NullishContract {
    return forProperty(field.type, field.meta);
  }

  /**
   * Plans a property when its type and metadata have already been normalized
   * into a compiler `Module.Field` or another immutable surface record.
   */
  public static function forProperty(type: Type,
      meta: Null<MetaAccess>): NullishContract {
    final source = classify(type);
    final optional = meta != null && meta.has(':optional');
    if (!optional)
      return forType(type);

    final tsOptional = meta.has(':ts.optional');
    final emittedType = (tsOptional || source.explicitUndefined)
      ? stripHaxeNull(type)
      : type;
    final emitted = classify(emittedType);
    final preservesUndefined = source.explicitUndefined
      || source.unknownBoundary;
    return new NullishContract(OptionalProperty, type, emittedType,
      source.haxeAllowsNull, emitted.haxeAllowsNull,
      source.explicitUndefined, source.unknownBoundary, source.dynamicBoundary,
      true, MissingAsUndefined, true, !preservesUndefined, tsOptional);
  }

  /**
   * Plans an effectively optional function parameter.
   *
   * Callers pass `effectiveOptional`, not merely Haxe's raw `arg.opt`: an
   * optional parameter followed by a required parameter cannot use TypeScript
   * optional syntax. Nullable Haxe optionals use a `null` default so the
   * function body observes Haxe absence, except when an explicit
   * `Undefinable`/`Unknown` boundary must preserve the host sentinel.
   * Undefined-aware optionals use TypeScript's `?` syntax and remain absent as
   * `undefined`.
   */
  public static function forParameter(type: Type,
      effectiveOptional: Bool): NullishContract {
    final facts = classify(type);
    final preservesUndefined = facts.explicitUndefined
      || facts.unknownBoundary;
    final emittedType = effectiveOptional && preservesUndefined
      ? stripHaxeNull(type)
      : type;
    final emitted = classify(emittedType);
    final missing = if (!effectiveOptional)
      NoMissingValue
    else if (preservesUndefined)
      MissingAsUndefined
    else if (facts.haxeAllowsNull)
      MissingAsNull
    else
      MissingAsUndefined;
    return new NullishContract(effectiveOptional ? OptionalParameter : Value,
      type, emittedType, facts.haxeAllowsNull, emitted.haxeAllowsNull,
      facts.explicitUndefined, facts.unknownBoundary, facts.dynamicBoundary,
      effectiveOptional, missing, effectiveOptional, false, false);
  }

  /**
   * Marks the native-map boundary: missing keys are observed as Haxe `null`.
   *
   * `genes.util.EsMap` realizes this fact at runtime with `Map.has` followed by
   * `Map.get`, preserving an explicitly stored JavaScript `undefined` value.
   */
  public static function forNativeMapRead(resultType: Type): NullishContract {
    final facts = classify(resultType);
    return new NullishContract(NativeMapRead, resultType, resultType,
      facts.haxeAllowsNull, facts.haxeAllowsNull, facts.explicitUndefined,
      facts.unknownBoundary, facts.dynamicBoundary, false, MissingAsNull,
      false, false, false);
  }

  /**
   * Marks iterator completion, whose JavaScript payload absence is
   * `undefined` rather than Haxe `null`.
   */
  public static function forIteratorCompletion(
      elementType: Type): NullishContract {
    final facts = classify(elementType);
    return new NullishContract(IteratorCompletion, elementType, elementType,
      facts.haxeAllowsNull, facts.haxeAllowsNull, true,
      facts.unknownBoundary, facts.dynamicBoundary, false,
      MissingAsUndefined, false, false, false);
  }

  /**
   * Removes the outer Haxe-null wrapper used for value narrowing/projection.
   *
   * General typedefs are followed because their alias can hide `Null<T>`.
   * Explicit boundary abstracts are not followed, which keeps
   * `Undefinable<T>` intact when stripping an optional field's synthetic outer
   * null wrapper.
   */
  public static function stripHaxeNull(type: Type): Type {
    return switch type {
      case TAbstract(_.get() => {pack: [], name: 'Null'}, [inner]) |
        TType(_.get() => {pack: [], name: 'Null'}, [inner]):
        inner;
      case TMono(ref):
        final inner = ref.get();
        inner == null ? type : stripHaxeNull(inner);
      case TType(_, _):
        stripHaxeNull(Context.follow(type));
      case TLazy(f):
        stripHaxeNull(f());
      default:
        type;
    }
  }

  static function classify(type: Type, depth = 0): NullishTypeFacts {
    // Haxe normally resolves a valid chain of type aliases before this method
    // needs to inspect the underlying type. The 64-step limit below is a safety
    // net for an unexpected recursive compiler type that might otherwise make
    // code generation loop forever; it is not a limit on aliases users may
    // write. The 66-link fixture in tests/deep-nullish-alias verifies that
    // ordinary aliases still preserve the exact null/undefined behavior.
    // See that fixture's README for a plain-language example and test command.
    if (depth > 64)
      return {
        haxeAllowsNull: true,
        explicitUndefined: false,
        unknownBoundary: false,
        dynamicBoundary: true
      };

    return switch type {
      case TAbstract(_.get() => {
        module: 'genes.ts.Undefinable',
        name: 'Undefinable'
      }, params):
        final inner = params.length == 1 ? classify(params[0], depth + 1) : emptyFacts();
        {
          haxeAllowsNull: inner.haxeAllowsNull,
          explicitUndefined: true,
          unknownBoundary: inner.unknownBoundary,
          dynamicBoundary: inner.dynamicBoundary
        };
      case TAbstract(_.get() => {
        module: 'genes.ts.Unknown',
        name: 'Unknown'
      }, _):
        {
          haxeAllowsNull: false,
          explicitUndefined: false,
          unknownBoundary: true,
          dynamicBoundary: false
        };
      case TAbstract(_.get() => {pack: [], name: 'Null'}, [inner]) |
        TType(_.get() => {pack: [], name: 'Null'}, [inner]):
        final nested = classify(inner, depth + 1);
        {
          haxeAllowsNull: true,
          explicitUndefined: nested.explicitUndefined,
          unknownBoundary: nested.unknownBoundary,
          dynamicBoundary: nested.dynamicBoundary
        };
      case TDynamic(_):
        {
          haxeAllowsNull: true,
          explicitUndefined: false,
          unknownBoundary: false,
          dynamicBoundary: true
        };
      case TMono(ref):
        final inner = ref.get();
        inner == null ? {
          haxeAllowsNull: true,
          explicitUndefined: false,
          unknownBoundary: false,
          dynamicBoundary: false
        } : classify(inner, depth + 1);
      case TType(_, _):
        classify(Context.follow(type), depth + 1);
      case TLazy(f):
        classify(f(), depth + 1);
      default:
        emptyFacts();
    }
  }

  static inline function emptyFacts(): NullishTypeFacts {
    return {
      haxeAllowsNull: false,
      explicitUndefined: false,
      unknownBoundary: false,
      dynamicBoundary: false
    };
  }
}
