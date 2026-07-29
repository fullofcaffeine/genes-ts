package genes.react.flight.v19;

/**
 * React 19 Flight value whose runtime representation is a native
 * JavaScript `ArrayBuffer`.
 *
 * The versioned type records the React transport contract without allocating
 * a wrapper or changing the value emitted to JavaScript/TypeScript.
 */
typedef FlightArrayBuffer = js.lib.ArrayBuffer;
