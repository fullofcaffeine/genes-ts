package react_flight;

import genes.react.flight.v19.FlightDate;

/**
 * Haxe-only compatibility spelling for a reusable Genes transport value.
 *
 * A host may preserve an established source name while requiring every
 * generated TypeScript annotation to use the underlying native `Date`.
 */
@:genes.compilerInternal
@:genes.semanticOnly
typedef HostFlightDate = FlightDate;

/** Proves a semantic-only alias cannot leak into an emitted signature. */
function formatDate(value: HostFlightDate): String {
  return value.toISOString();
}
