package react_flight;

import react_flight.FlightFixtureMacro.requireFlight;

class NegativeNestedResource {
  static function main(): Void {
    requireFlight("react_flight.FlightFixtureTypes.InvalidNestedResource",
      true);
  }
}
