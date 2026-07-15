package tests;

import tests.publicsurface.SurfaceParent.SurfaceChild;
import tests.publicsurface.SurfaceParent.SurfaceImplementation;
import tests.publicsurface.SurfaceParent.OverloadedSurface;

/** Exercises the runtime half of the shared public-surface fixture. */
@:asserts
class TestPublicSurface {
  public function new() {}

  public function testGenericImplementation() {
    final implementation = new SurfaceImplementation();
    final value: SurfaceChild<String> = implementation;
    asserts.assert(value.own("surface") == "surface");
    asserts.assert(value.inherited(["surface"])[0] == "surface");
    asserts.assert(implementation.label == "surface!");
    final overloaded = new OverloadedSurface();
    asserts.assert(overloaded.convert("surface") == "surface");
    asserts.assert(overloaded.convert(1) == 1);
    return asserts.done();
  }
}
