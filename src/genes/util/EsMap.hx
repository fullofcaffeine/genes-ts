package genes.util;

import js.lib.Map;

class EsMap<K, V> {
  var inst: Map<K, V>;

  public inline function new()
    inst = new Map();

  /**
   * Keep the facade methods non-inline so generated TS user modules call the
   * stable Haxe map API instead of exposing the backing native `Map` field.
   */
  public function set(key: K, value: V): Void
    inst.set(key, value);

  /**
   * Reads a value while preserving Haxe's `Null<V>` absence contract.
   *
   * Why: native `Map.get` returns `V | undefined`, while Haxe exposes
   * `Null<V>` and genes-ts renders that as `V | null`. Normalizing only missing
   * keys keeps both output modes honest without erasing a deliberately stored
   * `undefined` value.
   *
   * How: `Map.has` proves presence at runtime, but neither Haxe nor TypeScript
   * carries that correlation into the following generic `Map.get`.
   * `Register.unsafeCast` is the compiler runtime's typed identity boundary;
   * using it here confines the assertion and immediately returns `Null<V>`.
   */
  public function get(key: K): Null<V> {
    if (!inst.has(key))
      return null;
    return Register.unsafeCast(inst.get(key));
  }

  public function remove(key: K): Bool
    return inst.delete(key);

  public function exists(key: K): Bool
    return inst.has(key);

  public function keys(): Iterator<K>
    return adaptIterator(inst.keys());

  public function iterator(): Iterator<V>
    return adaptIterator(inst.values());

  public function toString(): String {
    return "{" + [for (key in keys()) '$key => ${get(key)}'].join(', ') + "}";
  }

  static function adaptIterator<T>(from: js.lib.Iterator<T>): Iterator<T> {
    var value: T;
    var done: Null<Bool>;
    function queue() {
      var data = from.next();
      value = data.value;
      // In TS lib types, `IteratorResult.done` is optional on yield results.
      // Treat `undefined` as `false` to avoid double-queueing.
      done = data.done == true;
    }
    return {
      hasNext: () -> {
        if (done == null)
          queue();
        return !done;
      },
      next: () -> {
        if (done == null)
          queue();
        var pending = value;
        queue();
        return pending;
      }
    }
  }

  public function clear() {
    inst.clear();
  }
}
