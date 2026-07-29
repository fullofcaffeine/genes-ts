package dual;

import genes.ts.Undefinable;
import genes.ts.Unknown;
import genes.ts.UnknownNarrow;
import dual.MixedNativeImportOwner.NativeGlobalPattern;

/**
 * Exercises genes-ts helper abstractions through both current output modes.
 *
 * Every `Unknown` value is narrowed immediately and every `Undefinable` value
 * is observed through an exact runtime predicate, so the fixture proves the
 * helper boundary without turning broad values into a domain model.
 */
class HelperScenario {
  /**
   * Produces a known-present host value with a type used only by the
   * `assumePresent()` assertion.
   *
   * Raw object syntax is confined to this fixture boundary because the
   * `AssertionOnlyBuffer` extern is intentionally not constructed at
   * runtime; ordinary code receives the precise typed contract immediately.
   */
  static inline function assertionOnlyPayload(): Undefinable<AssertionOnlyBuffer> {
    @:nullSafety(Off)
    return js.Syntax.code("({ length: 17 })");
  }

  public static function run(): Array<String> {
    final events: Array<String> = [];
    #if dual_import_attributes
    final profile = DualProfileResource.profile;
    final aliasesAgree = SameAliasProfileOne.profile == profile
      && SameAliasProfileTwo.profile == profile
      && FirstAliasProfile.profile == profile
      && SecondAliasProfile.profile == profile;
    events.push('json-import:${aliasesAgree ? profile : "alias-mismatch"}');
    #else
    events.push("json-import:dual-output");
    #end
    final absent: Undefinable<String> = Undefinable.absent();
    events.push('undefined:${UnknownNarrow.isUndefined(Unknown.fromBoundary(absent))}');

    final present: Undefinable<String> = "ready";
    final presentIsAbsent = Undefinable.isAbsent(present);
    if (!presentIsAbsent)
      events.push('present:${present.assumePresent()}');

    // `Undefinable<Null<T>>` distinguishes a present `null` from an absent
    // `undefined`. The assertion must preserve that nested null in both the
    // generated TypeScript type and the runtime value.
    final nullablePresent: Undefinable<Null<String>> = null;
    final nullablePresentIsAbsent = Undefinable.isAbsent(nullablePresent);
    if (!nullablePresentIsAbsent)
      events.push('present-null:${nullablePresent.assumePresent() == null}');

    events.push('present-type:${assertionOnlyPayload().assumePresent().length}');

    final boundary = Unknown.fromBoundary({name: "Ada"});
    final record = UnknownNarrow.record(boundary);
    final name = record == null ? null : UnknownNarrow.string(record.get("name"));
    events.push('unknown-record:$name');

    final array = UnknownNarrow.array(Unknown.fromBoundary(["first", "second"]));
    events.push('unknown-array:${array == null ? -1 : array.length}');

    final report = DualApi.summarize(["Ada", "Grace"]);
    events.push('api:${report.count}:${report.first}:${UnknownNarrow.isUndefined(Unknown.fromBoundary(report.missing))}');
    events.push('type-only:${DualApi.typeOnly() == null}');

    final pattern = new NativeGlobalPattern("^portable$");
    final fileName = MixedNativeImportOwner.basename("/dual/portable.txt");
    events.push('native-global:${pattern.test("portable")}:$fileName');
    return events;
  }
}
