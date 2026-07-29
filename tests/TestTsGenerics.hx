package tests;

import tests.util.NativePromise;
import tests.util.ModuleSource.sourceCode;
import tests.bar.MyClass in MyClassAlias;

@:asserts
class TestTsGenerics {
  public function new() {}

  var types = sourceCode(true);

  /**
   * Public declaration fixture for generic native-type mapping. `@:keep`
   * isolates the assertion from runtime DCE; classic declarations should emit
   * the intentional API as `globalThis.Promise<string>` without reopening
   * private fields or allowing a local `Promise` declaration to capture it.
   */
  @:keep public var checkType: NativePromise<String>;

  public function testType() {
    asserts.assert(types.contains('checkType: globalThis.Promise<string>'));
    return asserts.done();
  }
}
