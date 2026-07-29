package react_flight;

import genes.react.flight.v19.FlightGlobalSymbol;

/** Negative control proving native-symbol interop is intentionally one-way. */
class NegativeForgedGlobalSymbol {
  static function main(): Void {
    final raw = new js.lib.Symbol("local");
    final forged: FlightGlobalSymbol = raw;
    trace(forged);
  }
}
