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
    final join: (a: String, b: String) -> String = Imports.namedImport("path", "join");
    asserts.assert(join("a", "b") == "a/b");
    return asserts.done();
  }

  public function testDefaultImport() {
    final DummyCtor: js.lib.Function = Imports.defaultImport("../../tests/extern.js", "DummyClass");
    asserts.assert(DummyCtor != null);
    return asserts.done();
  }
}
