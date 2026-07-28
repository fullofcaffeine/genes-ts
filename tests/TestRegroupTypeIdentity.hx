package tests;

import tests.regroupidentity.RegroupIdentityApi;
import tests.regroupidentity.BoundaryPlanStep;
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

    final mixed = RegroupIdentityApi.unchanged(new MixedNullable(null,
      "unchanged"));
    switch mixed {
      case Mixed(value):
        asserts.assert(value.nullable == null);
        asserts.assert(value.plain == "unchanged");
    }

    final concrete = RegroupIdentityApi.concreteNullable(null);
    switch concrete {
      case Concrete(value):
        asserts.assert(value == null);
    }
    asserts.assert(RegroupIdentityApi.ordinaryNullableArgument(null) == null);
    asserts.assert(RegroupIdentityApi.guardedNullableArgument(null) == 0);
    asserts.assert(RegroupIdentityApi.guardedNullableArgument(7) == 7);
    asserts.assert(RegroupIdentityApi.nullableInitializer(null) == null);
    asserts.assert(RegroupIdentityApi.nullableAssignment(null) == null);
    asserts.assert(RegroupIdentityApi.nullableConstructor(null).value == null);
    asserts.assert(RegroupIdentityApi.boundaryOnlyImport() == "planned");
    return asserts.done();
  }
}
