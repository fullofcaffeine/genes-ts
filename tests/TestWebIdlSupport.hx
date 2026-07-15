package tests;

import tests.webidl.WebIdlGapApi;
import tink.unit.Assert.*;

/** Exercises the shared WebIDL declaration facts without requiring a browser. */
class TestWebIdlSupport {
  public function new() {}

  public function testDeclarationFixture() {
    return assert(new WebIdlGapApi().surface() == null);
  }
}
