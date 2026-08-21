package tests;

import tink.unit.Assert.*;

class TestRest {
  public function new() {}

  public function testMethodRest() {
    final values = someRest('a', 'b');
    return assert(values[0] == 'a' && values[1] == 'b');
  }

  public function testFunctionRest() {
    function someRest(...values: String) {
      return values.toArray();
    }
    final values = someRest('a', 'b');
    return assert(values[0] == 'a' && values[1] == 'b');
  }

  public function testOptionalBeforeRest() {
    final omitted = optionalBeforeRest();
    final supplied = optionalBeforeRest('label', 1, 2);
    return assert(omitted.arg == null
      && omitted.count == 0
      && supplied.arg == 'label'
      && supplied.count == 2);
  }

  function someRest(...values: String) {
    return values.toArray();
  }

  function optionalBeforeRest(?arg: String, ...values: Int): {
    arg: Null<String>,
    count: Int
  } {
    return {arg: arg, count: values.length};
  }
}
