package genes.react.flight.v19;

import genes.ts.Undefinable;

/**
 * Exact React 19 Flight view of a native JavaScript `Map`.
 *
 * Haxe 4.3.7 declares a missing `js.lib.Map.get` result as `Null<V>`, while
 * JavaScript and TypeScript return `undefined`. This extern preserves the
 * native identity and that exact absence contract without a wrapper. It keeps
 * the familiar native Map surface—including callbacks and iteration—so using
 * the precise Flight type does not cost ordinary JavaScript ergonomics.
 *
 * The constructor's iterable and `forEach`'s optional JavaScript `thisArg`
 * retain the same narrow external `Any` boundaries as Haxe 4.3.7's native Map
 * extern. Haxe has no precise structural type for either host protocol; keys,
 * values, callback parameters, and return values remain closed.
 */
@:native("Map")
extern class FlightMap<K, V> {
  var size(default, null): Int;

  /**
   * Creates the native Map.
   *
   * Haxe 4.3.7 has no precise structural extern for JavaScript's iterable
   * protocol, so this constructor parameter mirrors `js.lib.Map`'s narrow
   * external boundary. Every stored key and value remains typed as `K`/`V`.
   */
  @:pure function new(?iterable: Any): Void;

  @:pure function has(key: K): Bool;

  @:pure function get(key: K): Undefinable<V>;

  function set(key: K, value: V): FlightMap<K, V>;

  function delete(key: K): Bool;

  function clear(): Void;

  function forEach(callback: (value: V, key: K, map: FlightMap<K, V>) -> Void,
    ?thisArg: Any): Void;

  function keys(): js.lib.Iterator<K>;

  function values(): js.lib.Iterator<V>;

  function entries(): js.lib.Iterator<js.lib.KeyValue<K, V>>;

  inline function iterator(): js.lib.HaxeIterator<V> {
    return new js.lib.HaxeIterator(values());
  }

  inline function keyValueIterator(): js.lib.HaxeIterator<js.lib.KeyValue<K,
    V>> {
    return new js.lib.HaxeIterator(entries());
  }
}
