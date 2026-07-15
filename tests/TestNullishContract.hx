package tests;

import js.lib.Set;
import tests.nullish.NullishMatrix;
import tink.unit.Assert.*;

/**
 * Paired runtime proof for the shared compiler `NullishContract` vocabulary.
 *
 * The same assertions run after classic JS emission and TS-source emission.
 * External TypeScript consumers complement them by proving the exact static
 * unions and optional-property write rules.
 */
@:asserts
class TestNullishContract {
  public function new() {}

  public function testNullishMatrix() {
    final shape = NullishMatrix.create();

    asserts.assert(shape.nullable == null);
    asserts.assert(NullishMatrix.isUndefined(shape.undefinable));
    asserts.assert(!NullishMatrix.hasOwn(shape, 'ordinaryOptional'));
    asserts.assert(NullishMatrix.hasOwn(shape, 'typescriptOptional'));
    asserts.assert(NullishMatrix.hasOwn(shape, 'optionalUndefinable'));
    asserts.assert(NullishMatrix.isUndefined(shape.optionalUndefinable));
    asserts.assert(NullishMatrix.isUndefined(
      NullishMatrix.optionalUndefined()));
    asserts.assert(NullishMatrix.optionalNullable() == null);

    final nativeValues = new Set<String>(['sentinel']).values();
    NullishMatrix.next(nativeValues);
    final completed = NullishMatrix.next(nativeValues);
    asserts.assert(NullishMatrix.isCompleted(completed));
    asserts.assert(NullishMatrix.completionValueIsUndefined(completed));

    return asserts.done();
  }
}
