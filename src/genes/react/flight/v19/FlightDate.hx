package genes.react.flight.v19;

/**
 * React 19 Flight value whose runtime representation is a native JavaScript
 * `Date`.
 *
 * The versioned name records which React transport contract admits the value;
 * the typedef preserves the exact zero-wrapper runtime representation.
 */
typedef FlightDate = js.lib.Date;
