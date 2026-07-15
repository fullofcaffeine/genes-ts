package tests.nullish;

import genes.ts.Undefinable;
import js.lib.Iterator;
import js.lib.Iterator.IteratorStep;

/**
 * Same-source record covering the distinct nullish contracts genes supports.
 *
 * Why: a successful TypeScript build cannot prove that `null`, `undefined`,
 * property omission, and Haxe-visible optional values stayed distinct: a broad
 * type or an eager `?? null` rewrite can make incorrect code compile. This
 * fixture is emitted by both classic Genes and genes-ts, while external strict
 * TypeScript consumers verify the projected property types separately.
 *
 * What/How: each field represents one reusable boundary rule. The optional
 * `Undefinable` member is particularly important: it is physically optional
 * and explicitly permits `undefined`, so generated TS must not normalize a
 * read to `null` merely because Haxe wrapped the optional field in `Null`.
 */
typedef NullishMatrixShape = {
  final nullable: Null<String>;
  final undefinable: Undefinable<String>;
  @:optional final ordinaryOptional: String;
  @:ts.optional final ?typescriptOptional: String;
  @:optional final optionalUndefinable: Undefinable<String>;
}

/**
 * Exercises value, property, parameter, map-adjacent, and iterator absence
 * without exposing `Dynamic` in the test API.
 *
 * Raw JavaScript identity checks are confined to the three small methods that
 * need operations Haxe cannot express directly: exact `undefined`, own-field
 * presence, and the optional value on a native iterator result. Each returns a
 * typed `Bool`; no dynamic value escapes the fixture API.
 */
class NullishMatrix {
  /** Builds all declared sentinels while deliberately omitting one property. */
  public static function create(
      ?typescriptOptional: String): NullishMatrixShape {
    return {
      nullable: null,
      undefinable: Undefinable.absent(),
      typescriptOptional: typescriptOptional,
      optionalUndefinable: Undefinable.absent()
    };
  }

  /** Preserves omission as JavaScript `undefined` for an explicit boundary. */
  public static function optionalUndefined(
      ?value: Undefinable<String>): Undefinable<String> {
    return value == null ? Undefinable.absent() : value;
  }

  /** Models the ordinary Haxe optional-parameter contract. */
  public static function optionalNullable(?value: String): Null<String> {
    return value;
  }

  /** Returns whether a typed record contains an own property. */
  public static function hasOwn(shape: NullishMatrixShape,
      name: String): Bool {
    // The call-form works for null-prototype objects and objects that shadow
    // `hasOwnProperty`; Haxe has no typed own-property primitive.
    return js.Syntax.code('Object.prototype.hasOwnProperty.call({0}, {1})',
      shape, name);
  }

  /** Checks exact JavaScript `undefined` through the typed boundary helper. */
  public static function isUndefined<T>(value: T): Bool {
    // Haxe cannot spell `undefined` as an ordinary value. Keep the raw identity
    // check here and return a normal Bool immediately.
    return js.Syntax.code('({0}) === undefined', value);
  }

  /** Exposes the native iterator-step contract for declaration verification. */
  public static function next(
      iterator: Iterator<String>): IteratorStep<String> {
    return iterator.next();
  }

  /** Checks the optional iterator discriminator without widening to `Bool`. */
  public static function isCompleted(step: IteratorStep<String>): Bool {
    return step.done == true;
  }

  /** Preserves and observes the native iterator completion payload sentinel. */
  public static function completionValueIsUndefined(
      step: IteratorStep<String>): Bool {
    // `IteratorStep.value` is optional in the Haxe extern. Inspecting it via a
    // normal typed field read would intentionally apply Haxe's `?? null`
    // normalization, so this boundary assertion observes the native protocol
    // before that source-facing normalization.
    return js.Syntax.code('({0}).value === undefined', step);
  }
}
