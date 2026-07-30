package module_functions;

import module_functions.DependencyOrderState;

@:genes.moduleFunction("directOrderValue")
function directOrderValue(): Int {
  return 2;
}

function __init__(): Void {
  DependencyOrderState.events.push("direct");
}
