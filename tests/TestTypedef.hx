package tests;

import tink.unit.Assert.*;

typedef A = {
  test: Int
}

typedef NativeFunctionPayload = {
  final value:Int;
}

/**
 * Runtime-key regression for `@:native` on anonymous fields.
 *
 * Haxe source uses `fn` because `function` is a JS keyword, but emitted
 * JavaScript must use the native property name so external payloads have the
 * correct shape.
 */
typedef NativeFunctionRecord = {
  @:native("function")
  final fn:NativeFunctionPayload;
}

@:asserts
class TestTypedef {
  public function new() {}

  function test(): A
    return {test: 1}

  function testB(): ExternalTypedef.B
    return {test: 1}

  function nativeFunctionRecord(): NativeFunctionRecord
    return {fn: {value: 2}}

  public function testTypedef() {
    asserts.assert(test().test == 1);
    asserts.assert(testB().test == 1);
    asserts.assert(nativeFunctionRecord().fn.value == 2);
    final keys = Reflect.fields(nativeFunctionRecord());
    asserts.assert(keys.indexOf("function") >= 0);
    asserts.assert(keys.indexOf("fn") == -1);
    return asserts.done();
  }
}
