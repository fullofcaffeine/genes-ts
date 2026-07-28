package genes.react.flight.v19;

/**
 * Exact binding for JavaScript's global symbol registry factory.
 *
 * The dotted native self-call makes genes emit canonical `Symbol.for(key)`
 * rather than a runtime helper or computed property call.
 */
@:native("Symbol.for")
private extern class GlobalSymbolFactory {
  @:selfCall
  static function create(key: String): js.lib.Symbol;
}

@:native("String")
private extern class GlobalSymbolLabel {
  @:selfCall
  static function create(value: js.lib.Symbol): String;
}

/** Exact binding for reading a proven global symbol's registry key. */
@:native("Symbol.keyFor")
private extern class GlobalSymbolKey {
  @:selfCall
  static function read(value: js.lib.Symbol): String;
}

/**
 * React 19 Flight symbol proven to come from JavaScript's global registry.
 *
 * A raw `js.lib.Symbol` cannot convert to this type: locally created symbols
 * have the same JavaScript representation but not the required Flight
 * provenance. `forKey` is therefore the only public construction path. The
 * one-way projection to `js.lib.Symbol` keeps ordinary native interop without
 * allowing that interop type to forge this capability.
 */
abstract FlightGlobalSymbol(js.lib.Symbol) to js.lib.Symbol {
  private inline function new(value: js.lib.Symbol) {
    this = value;
  }

  public static inline function forKey(key: String): FlightGlobalSymbol {
    return new FlightGlobalSymbol(GlobalSymbolFactory.create(key));
  }

  /**
   * Returns the exact global-registry key used by `forKey`.
   *
   * JavaScript `Symbol.keyFor` can return `undefined` for a local symbol, but
   * that case is unrepresentable here because raw symbols cannot construct a
   * `FlightGlobalSymbol`.
   */
  public inline function key(): String {
    return GlobalSymbolKey.read(this);
  }

  /** Returns JavaScript's stable display label, such as `Symbol(app.marker)`. */
  public inline function label(): String {
    return GlobalSymbolLabel.create(this);
  }
}
