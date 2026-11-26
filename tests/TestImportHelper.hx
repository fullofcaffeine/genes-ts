package tests;

import genes.ts.Imports;

typedef PathNamespace = {
  join: (a: String, b: String) -> String
};

@:asserts
class TestImportHelper {
  public function new() {}

  // Field initializer context: should prefer "nice" import names (no local-scope aliasing).
  static final PathNS: PathNamespace = Imports.namespaceImport("path");

  public function testNamespaceImport() {
    asserts.assert(PathNS.join("a", "b") == "a/b");
    return asserts.done();
  }

  public function testNamedImportLowercase() {
    // Method context: should use a local-scope-safe import alias.
    final join: (a: String,
      b: String) -> String = Imports.namedImport("path", "join");
    asserts.assert(join("a", "b") == "a/b");
    return asserts.done();
  }

  public function testTwoHoldersOfOneImport() {
    // This module's own holder of `join` from "path" and the holder of
    // `ImportHelperShared`, which the inline call brings in, share one
    // import line (genes-f8vc.14.43). A second line would not load.
    final join: (a: String,
      b: String) -> String = Imports.namedImport("path", "join");
    asserts.assert(join("a", "b") == ImportHelperShared.join()("a", "b"));
    return asserts.done();
  }

  public function testDefaultImport() {
    final DummyCtor: js.lib.Function = Imports.defaultImport("../../tests/extern.js",
      "DummyClass");
    asserts.assert(DummyCtor != null);
    return asserts.done();
  }
}
