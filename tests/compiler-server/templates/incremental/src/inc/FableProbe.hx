package inc;

/**
 * A structure field that declares its own type parameter (genes-f8vc.9.26,
 * M3 of the cross-model review of genes-ts #246). `inc.FableMacro` writes
 * `@:ts.type("string")` on that type parameter, or on a field of a
 * structure in its constraint, from another module, after typing. Haxe
 * does not type this module again, so only its fingerprint shows the
 * change.
 */
typedef FableApi = {
  function pick<T>(item: T): T;
}

@:keep
class FableProbe {
  public static var held: Null<FableApi> = null;

  /** The same shape inline in the type of a class field. */
  public static function call(api: {function sel<U>(item: U): U;},
      n: Int): Int {
    return api.sel(n);
  }

  /** A structure in the constraint of a structure field's type parameter. */
  public static function wide(api: {function sel<W: {w: Int}>(item: W): Int;}): Int {
    return api.sel({w: 1});
  }

  public static function use(api: FableApi, n: Int): Int {
    return api.pick(n);
  }

  public static function value(): String {
    final api = held;
    return api == null ? "fable" : Std.string(use(api, 1));
  }
}
