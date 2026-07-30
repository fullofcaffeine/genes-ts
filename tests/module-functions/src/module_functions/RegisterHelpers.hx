package module_functions;

/**
 * Proves expression helpers remain reachable without class registration.
 *
 * A Haxe method closure lowers through `genes.Register.bind`. Because this
 * module contains only a selected top-level function, its compiler-synthetic
 * owner disappears; dependency planning must retain Register for the closure
 * itself rather than accidentally relying on owner registration.
 */
@:genes.moduleFunction("appendWithBoundMethod")
function appendWithBoundMethod(values: Array<Int>): Int {
  final output: Array<Int> = [];
  final append = output.push;
  for (value in values)
    append(value);
  return output.length;
}
