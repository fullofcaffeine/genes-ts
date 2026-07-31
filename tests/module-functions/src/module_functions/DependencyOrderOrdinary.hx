package module_functions;

import module_functions.DependencyOrderState;

/** Ordinary module value intentionally evaluated before the direct call. */
final ordinaryOrderValue: Int = 1;

function __init__(): Void {
  DependencyOrderState.events.push("ordinary");
}
