package deepnullish;

import genes.ts.Undefinable;
import haxe.ds.StringMap;

/**
 * Test-only aliases that check whether Genes preserves precise value types.
 *
 * A Haxe `typedef` can give an existing type another name. For example,
 * `typedef UserName = String` lets an API say `UserName` while the value remains
 * a string. Aliases may also refer to other aliases, as the numbered
 * `DeepLink` declarations below do.
 *
 * This file deliberately uses a much longer chain than an application usually
 * would. It checks that the compiler still understands three important cases
 * at the end of that chain:
 *
 * - `DeepPlain` is always a string;
 * - `DeepNullable` may contain a string or Haxe `null`; and
 * - `DeepUndefinable` may contain a string or JavaScript `undefined`.
 *
 * Why 66 links? Genes has an internal safety check that stops following a
 * suspicious recursive type after 64 steps. Valid aliases should be resolved
 * normally before that safety check is needed. Going just beyond the limit
 * proves that ordinary, valid code is not accidentally weakened by it.
 *
 * The aliases are public only so the test's external TypeScript programs can
 * inspect the complete generated API. They are fixture data, not helpers that
 * application code should import from Genes.
 *
 * See also: `tests/deep-nullish-alias/README.md` explains the three compiler
 * profiles and the exact command that verifies this fixture.
 */
typedef DeepLink00<T> = T;
typedef DeepLink01<T> = DeepLink00<T>;
typedef DeepLink02<T> = DeepLink01<T>;
typedef DeepLink03<T> = DeepLink02<T>;
typedef DeepLink04<T> = DeepLink03<T>;
typedef DeepLink05<T> = DeepLink04<T>;
typedef DeepLink06<T> = DeepLink05<T>;
typedef DeepLink07<T> = DeepLink06<T>;
typedef DeepLink08<T> = DeepLink07<T>;
typedef DeepLink09<T> = DeepLink08<T>;
typedef DeepLink10<T> = DeepLink09<T>;
typedef DeepLink11<T> = DeepLink10<T>;
typedef DeepLink12<T> = DeepLink11<T>;
typedef DeepLink13<T> = DeepLink12<T>;
typedef DeepLink14<T> = DeepLink13<T>;
typedef DeepLink15<T> = DeepLink14<T>;
typedef DeepLink16<T> = DeepLink15<T>;
typedef DeepLink17<T> = DeepLink16<T>;
typedef DeepLink18<T> = DeepLink17<T>;
typedef DeepLink19<T> = DeepLink18<T>;
typedef DeepLink20<T> = DeepLink19<T>;
typedef DeepLink21<T> = DeepLink20<T>;
typedef DeepLink22<T> = DeepLink21<T>;
typedef DeepLink23<T> = DeepLink22<T>;
typedef DeepLink24<T> = DeepLink23<T>;
typedef DeepLink25<T> = DeepLink24<T>;
typedef DeepLink26<T> = DeepLink25<T>;
typedef DeepLink27<T> = DeepLink26<T>;
typedef DeepLink28<T> = DeepLink27<T>;
typedef DeepLink29<T> = DeepLink28<T>;
typedef DeepLink30<T> = DeepLink29<T>;
typedef DeepLink31<T> = DeepLink30<T>;
typedef DeepLink32<T> = DeepLink31<T>;
typedef DeepLink33<T> = DeepLink32<T>;
typedef DeepLink34<T> = DeepLink33<T>;
typedef DeepLink35<T> = DeepLink34<T>;
typedef DeepLink36<T> = DeepLink35<T>;
typedef DeepLink37<T> = DeepLink36<T>;
typedef DeepLink38<T> = DeepLink37<T>;
typedef DeepLink39<T> = DeepLink38<T>;
typedef DeepLink40<T> = DeepLink39<T>;
typedef DeepLink41<T> = DeepLink40<T>;
typedef DeepLink42<T> = DeepLink41<T>;
typedef DeepLink43<T> = DeepLink42<T>;
typedef DeepLink44<T> = DeepLink43<T>;
typedef DeepLink45<T> = DeepLink44<T>;
typedef DeepLink46<T> = DeepLink45<T>;
typedef DeepLink47<T> = DeepLink46<T>;
typedef DeepLink48<T> = DeepLink47<T>;
typedef DeepLink49<T> = DeepLink48<T>;
typedef DeepLink50<T> = DeepLink49<T>;
typedef DeepLink51<T> = DeepLink50<T>;
typedef DeepLink52<T> = DeepLink51<T>;
typedef DeepLink53<T> = DeepLink52<T>;
typedef DeepLink54<T> = DeepLink53<T>;
typedef DeepLink55<T> = DeepLink54<T>;
typedef DeepLink56<T> = DeepLink55<T>;
typedef DeepLink57<T> = DeepLink56<T>;
typedef DeepLink58<T> = DeepLink57<T>;
typedef DeepLink59<T> = DeepLink58<T>;
typedef DeepLink60<T> = DeepLink59<T>;
typedef DeepLink61<T> = DeepLink60<T>;
typedef DeepLink62<T> = DeepLink61<T>;
typedef DeepLink63<T> = DeepLink62<T>;
typedef DeepLink64<T> = DeepLink63<T>;
typedef DeepLink65<T> = DeepLink64<T>;
typedef DeepLink66<T> = DeepLink65<T>;

typedef DeepPlain = DeepLink66<String>;
typedef DeepNullable = DeepLink66<Null<String>>;
typedef DeepUndefinable = DeepLink66<Undefinable<String>>;

/**
 * A small public object used to check the three alias outcomes from TypeScript.
 *
 * Keeping all three fields together makes an accidental type widening easy to
 * spot: each external consumer must accept the intended value and reject values
 * such as `null` or `undefined` where they do not belong.
 */
typedef DeepAliasShape = {
  final plain:DeepPlain;
  final nullable:DeepNullable;
  final undefinable:DeepUndefinable;
}

/**
 * Places the long aliases in ordinary API and runtime situations.
 *
 * The object fields and small pass-through methods check function parameters
 * and return values. The map methods cover one easy-to-confuse case: Haxe uses
 * `null` when a map key is missing, while a stored `Undefinable` value can be
 * the separate JavaScript value `undefined`. The test must preserve that
 * difference in standard Haxe JavaScript, classic Genes JavaScript, and Genes
 * TypeScript output.
 *
 * Everything here uses ordinary typed Haxe. If this test ever needs a cast,
 * `Dynamic`, or a raw JavaScript expression, that would hide the type behavior
 * it is intended to verify.
 */
class DeepNullishAliases {
  public static function shape():DeepAliasShape {
    return {
      plain: "plain",
      nullable: null,
      undefinable: Undefinable.absent()
    };
  }

  public static function plain(value:DeepPlain):DeepPlain {
    return value;
  }

  public static function nullable(value:DeepNullable):DeepNullable {
    return value;
  }

  public static function undefinable(
      value:DeepUndefinable):DeepUndefinable {
    return value;
  }

  public static function plainMapRead(values:StringMap<DeepPlain>,
      key:String):Null<DeepPlain> {
    return values.get(key);
  }

  public static function nullableMapRead(values:StringMap<DeepNullable>,
      key:String):Null<DeepNullable> {
    return values.get(key);
  }

  public static function undefinableMapRead(
      values:StringMap<DeepUndefinable>,
      key:String):Null<DeepUndefinable> {
    return values.get(key);
  }

  /**
   * Returns simple text results that can be compared across all three profiles.
   *
   * Each entry records one behavior the generated program must preserve, such
   * as whether a missing map key is `null` or a stored value is `undefined`.
   */
  public static function run():Array<String> {
    final value = shape();

    final plainValues = new StringMap<DeepPlain>();
    plainValues.set("present", "mapped");

    final nullableValues = new StringMap<DeepNullable>();
    nullableValues.set("present", null);

    final undefinableValues = new StringMap<DeepUndefinable>();
    undefinableValues.set("present", Undefinable.absent());
    final missingUndefinable = undefinableMapRead(undefinableValues, "missing");

    return [
      'shape:${plain(value.plain)}:${nullable(value.nullable) == null}:${Undefinable.isAbsent(undefinable(value.undefinable))}',
      'plain-map:${plainMapRead(plainValues, "present")}:${plainMapRead(plainValues, "missing") == null}',
      'nullable-map:${nullableMapRead(nullableValues, "present") == null}:${nullableMapRead(nullableValues, "missing") == null}',
      'undefinable-map:${Undefinable.isAbsent(undefinableMapRead(undefinableValues, "present"))}:${Undefinable.isAbsent(missingUndefinable)}:${missingUndefinable == null}'
    ];
  }
}
