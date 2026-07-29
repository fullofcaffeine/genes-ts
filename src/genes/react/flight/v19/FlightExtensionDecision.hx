package genes.react.flight.v19;

#if macro
/**
 * Closed response from a React host for an otherwise unknown nominal type.
 *
 * `Accept` trusts the host's compile-time provenance proof for a capability
 * with no nested value type to walk; it performs no runtime check or wrapping.
 * `Recurse` preserves Genes' validation of one or more named nested payloads.
 * `Reject` lets the host provide a capability-specific reason. `Unhandled`
 * returns control to Genes' conservative default rejection. Empty or cyclic
 * recursion requests fail closed.
 */
enum FlightExtensionDecision {
  Unhandled;
  Accept;
  Recurse(values: Array<FlightNestedValue>);
  Reject(reason: String);
}
#end
