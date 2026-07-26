package tests;

import tests.regroupidentity.RegroupIdentityApi;
import tests.regroupidentity.MixedNullableStep;
import tests.regroupidentity.MixedNullableStep.MixedNullable;

@:asserts
class TestRegroupTypeIdentity {
  public function new() {}

  /**
   * Keeps the precision fixture in the executable graph for both profiles.
   *
   * The external TypeScript consumers verify static precision; this assertion
   * separately proves that retaining those declarations does not change the
   * runtime values.
   */
  public function testOrdinarySameNamedTypes() {
    final status = RegroupIdentityApi.status("flowing");
    final result = RegroupIdentityApi.result(7, "converted", true);

    asserts.assert(status.value == "flowing");
    asserts.assert(result.input == 7);
    asserts.assert(result.output == "converted");
    asserts.assert(result.quality);

    final mixed = RegroupIdentityApi.unchanged(
      new MixedNullable(null, "unchanged")
    );
    switch mixed {
      case Mixed(value):
        asserts.assert(value.nullable == null);
        asserts.assert(value.plain == "unchanged");
    }
    return asserts.done();
  }
}
