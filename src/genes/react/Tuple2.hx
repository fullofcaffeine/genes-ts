package genes.react;

/** Compiler-only indexed storage used by the public tuple projection. */
@:genes.compilerInternal
private typedef Tuple2Storage<A, B> = {
  @:native("[0]")
  var first: A;

  @:native("[1]")
  var second: B;
}

/**
 * Zero-runtime view of a mutable JavaScript two-element tuple.
 *
 * Why: APIs such as React Hooks return positional pairs whose two elements
 * have different types. `Array<A | B>` would lose that relationship in Haxe.
 *
 * What: `first` and `second` retain the exact element types, while generated
 * TypeScript receives `[A, B]`.
 *
 * How: the abstract erases to the host tuple. Computed `@:native` member names
 * lower its inline accessors to `[0]` and `[1]`; no wrapper is allocated.
 */
@:ts.type("[$0, $1]")
abstract Tuple2<A, B>(Tuple2Storage<A, B>) {
  public var first(get, set): A;
  public var second(get, set): B;

  inline function get_first(): A {
    return this.first;
  }

  inline function set_first(value: A): A {
    return this.first = value;
  }

  inline function get_second(): B {
    return this.second;
  }

  inline function set_second(value: B): B {
    return this.second = value;
  }
}
