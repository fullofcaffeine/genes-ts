package genes.react.internal;

/**
 * Forgeable compile-only hint for one HXX source-projection candidate.
 *
 * `genes.react.JSX` adds explicit private access when it creates HXX roots, but
 * another macro can do the same. This nominal value therefore grants no
 * representation authority. `JsxPlan` uses it only to narrow candidate
 * analysis, then requires complete request-local use accounting and the exact
 * linked-carrier grammar before source output may change representation.
 */
@:genes.compilerInternal
@:noCompletion
extern class HxxRootCandidate {
  private static function issue(): HxxRootCandidate;
}
