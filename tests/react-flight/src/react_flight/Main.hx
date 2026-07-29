package react_flight;

import genes.react.flight.v19.FlightGlobalSymbol;
import genes.react.flight.v19.FlightMap;
import react_flight.CompatibilityAliases.formatDate;
import react_flight.CompatibilityAliases.HostFlightDate;
import react_flight.FlightFixtureMacro.requireFlight;

/**
 * Roots the framework-neutral React Flight fixture for both output profiles.
 *
 * Haxe requires a class for `-main`; the capability and validation APIs remain
 * module/type declarations rather than an all-static application namespace.
 */
class Main {
  static function main(): Void {
    requireFlight("react_flight.FlightFixtureTypes.AcceptedPayload", true);

    final marker = FlightGlobalSymbol.forKey("genes.fixture");
    final nativeMarker: js.lib.Symbol = marker;
    final values = new FlightMap<String, Int>();
    final createdAt: HostFlightDate = new js.lib.Date();
    values.set("count", 1);
    var visited = 0;
    values.forEach((value, key, owner) -> {
      if (key == "count" && owner == values) {
        visited += value;
      }
    });
    final iterated = [for (value in values) value];
    final firstEntry = values.keyValueIterator().next();
    if (marker.key() != "genes.fixture"
      || js.lib.Symbol.keyFor(nativeMarker) != "genes.fixture"
      || marker.label() == ""
      || !values.has("count")
      || values.get("missing") != null
      || visited != 1
      || iterated.length != 1
      || firstEntry.key != "count"
      || formatDate(createdAt) == "") {
      throw "React Flight runtime identities were not preserved";
    }
  }
}
