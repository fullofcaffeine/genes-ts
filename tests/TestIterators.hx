package tests;

import genes.Register;
import tink.unit.Assert.*;

// benmerckx/genes#72

class TestClass {
  public static function testIterator(a: String) {
    return iterator(a);
  }

  public static function iterator(a: String) {
    return a;
  }
}

class TestIterators {
  public function new() {}

  public function testDynamicIterator() {
    final array: Iterable<Int> = [1, 2, 3];
    return assert([for (n in array) n].join('') == '123');
  }

  public function testGetIteratorOnDynamicArray() {
    final x: Dynamic = [0];
    return assert(x.iterator().next() == 0);
  }

  public function testIteratorName() {
    return assert(TestClass.testIterator('ok') == 'ok');
  }

  public function testDynamicIteratorExpr() {
    final a: Dynamic = {
      iterator: 0
    }
    return assert(a.iterator == 0);
  }

  public function testDynamicArrayIterator() {
    final a: Dynamic = [0];
    return assert(a.iterator().next() == 0);
  }

  public function testDynamicArrayIteratorProperty() {
    final a: Dynamic = [0];
    final x = a.iterator;
    return assert(x().next() == 0);
  }

  // benmerckx/genes#82
  public function testIteratorWithImportAlias() {
    final set = new Set<Int>();
    set.add(1);
    set.add(2);
    var count = 0;
    for (item in set) {
      count++;
    }
    return assert(count == 2);
  }

  public function testMapLikeIteratorFallback() {
    final source = new OrderedMapLike();
    final factory:Void->Iterator<String> = Register.iterator(source);
    final directIterator:Iterator<String> = Register.getIterator(source);
    final fromFactory = collect(factory());
    final direct = collect(directIterator);
    return assert(fromFactory == "alpha,beta" && direct == "alpha,beta");
  }

  public function testStructuralIteratorKeepsReceiver() {
    final source = new ReceiverAwareIterable();
    final factory:Void->Iterator<String> = Register.iterator(source);
    final first = collect(factory());
    final second = collect(factory());
    return assert(first == "one,two" && second == "one,two" && source.calls == 2);
  }

  static function collect(iterator:Iterator<String>):String {
    final values = [];
    while (iterator.hasNext())
      values.push(iterator.next());
    return values.join(",");
  }
}

/**
 * Minimal structural map-like input for `Register.iterator`.
 *
 * It deliberately has `keys()` and `get()` but no `iterator()` method, proving
 * that the runtime's map fallback visits values in the key iterator's order.
 * `@:keep` mirrors real structural JS values: Genes discovers these methods by
 * name at runtime, so Haxe's typed call graph cannot otherwise see the use.
 */
private class OrderedMapLike {
  final values = ["alpha" => "alpha", "beta" => "beta"];

  public function new() {}

  @:keep public function keys():Iterator<String> {
    return ["alpha", "beta"].iterator();
  }

  @:keep public function get(key:String):Null<String> {
    return values.get(key);
  }
}

/**
 * Iterator-shaped value whose method reads and updates its receiver.
 *
 * Returning `a.iterator` without binding it would lose `this` in JavaScript.
 * The call counter makes that receiver contract observable in both profiles.
 * `@:keep` is necessary because the runtime performs the lookup dynamically.
 */
private class ReceiverAwareIterable {
  public var calls(default, null) = 0;

  public function new() {}

  @:keep public function iterator():Iterator<String> {
    calls++;
    return ["one", "two"].iterator();
  }
}
