package module_functions;

/**
 * `@:genes.moduleFunction` selects the direct ESM representation. The separate
 * `@:expose` request publishes that same binding from the compilation root.
 */
@:expose("exposedTopLevel")
@:genes.moduleFunction("exposedTopLevel")
function authoredTopLevelName(value: String): String {
  return value;
}
