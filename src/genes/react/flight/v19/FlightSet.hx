package genes.react.flight.v19;

/**
 * React 19 Flight set whose element type is checked recursively.
 *
 * This typedef keeps the native JavaScript `Set` identity and introduces no
 * conversion, helper, or runtime allocation.
 */
typedef FlightSet<T> = js.lib.Set<T>;
