package tests;

import tests.staticcallable.InferredStaticFactory.StaticCallableSignatureApi;
import tests.staticcallable.ConstrainedStaticFactory.ConstrainedStaticSignatureApi;
import tests.staticcallable.StaticConstraint;

@:asserts
class TestStaticCallableSignature {
  public function new() {}

  public function testInferredStaticGeneric() {
    final value = StaticCallableSignatureApi.create("planned");
    asserts.assert(value.read() == "planned");
    asserts.assert(StaticCallableSignatureApi.ordinary(7) == 7);
    final constrained = ConstrainedStaticSignatureApi.create(new StringConstraint("closed"));
    asserts.assert(constrained.value.get() == "closed");
    return asserts.done();
  }
}

private class StringConstraint implements StaticConstraint<String> {
  final value: String;

  public function new(value: String) {
    this.value = value;
  }

  public function get(): String {
    return value;
  }
}
