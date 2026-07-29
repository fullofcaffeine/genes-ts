package react_flight;

import react_flight.FlightFixtureMacro.requireFlight;

class NegativeHostCycle {
  static function main(): Void {
    requireFlight("react_flight.FlightFixtureTypes.CyclicHostCapability", true);
  }
}
