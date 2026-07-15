package tests;

import genes.ts.Unknown;
import genes.ts.UnknownNarrow;
import genes.ts.Undefinable;
import tink.unit.Assert.*;

@:asserts
class TestMap {
  public function new() {}

  public function testStringMap() {
    final map = new Map<String, Bool>();
    map.set('test', true);

    function test(target: Map<String, Bool>) {
      asserts.assert(target.get('test'));
      asserts.assert(target['test']);
      asserts.assert([for (v in target) v][0]);
      asserts.assert([for (k in target.keys()) k][0] == 'test');
      asserts.assert([for (k => v in target) v][0]);
      asserts.assert([for (k => v in target) k][0] == 'test');
    }

    test(map);
    test(map.copy());

    return asserts.done();
  }

  public function testIntMap() {
    final map = new Map<Int, Bool>();
    map.set(1, true);

    function test(target: Map<Int, Bool>) {
      asserts.assert(target.get(1));
      asserts.assert(target[1]);
      asserts.assert([for (v in target) v][0]);
      asserts.assert([for (k in target.keys()) k][0] == 1);
      asserts.assert([for (k => v in target) v][0]);
      asserts.assert([for (k => v in target) k][0] == 1);
    }

    test(map);
    test(map.copy());

    return asserts.done();
  }

  public function testObjectMap() {
    final key = {}
    final map = new Map<{}, Bool>();
    map.set(key, true);

    function test(target: Map<{}, Bool>) {
      asserts.assert(target.get(key));
      asserts.assert(target[key]);
      asserts.assert([for (v in target) v][0]);
      asserts.assert([for (k in target.keys()) k][0] == key);
      asserts.assert([for (k => v in target) v][0]);
      asserts.assert([for (k => v in target) k][0] == key);
    }

    test(map);
    test(map.copy());

    return asserts.done();
  }

  public function issue56() {
    asserts.assert(([1 => true] : haxe.Constraints.IMap<Int, Bool>)
      .keyValueIterator != null);
    asserts.assert(([1 => true].copy() : haxe.Constraints.IMap<Int, Bool>)
      .keyValueIterator != null);

    return asserts.done();
  }

  public function mangleIterators() {
    final map = new Map();
    map.set('test', true);
    final test = Lambda.array(map);
    return assert(test[0]);
  }

  /**
   * Map absence is Haxe `null`, while a deliberately stored JavaScript
   * `undefined` remains a present value distinguishable through `exists`.
   */
  public function nullishBoundary() {
    final map = new Map<String, Undefinable<String>>();
    map.set('present-undefined', Undefinable.absent());

    asserts.assert(js.Syntax.strictEq(map.get('missing'), null));
    asserts.assert(map.exists('present-undefined'));
    asserts.assert(UnknownNarrow.isUndefined(
      Unknown.fromBoundary(map.get('present-undefined'))));

    return asserts.done();
  }
}
