package module_functions;

/**
 * One source module may contain both a direct function and an ordinary value.
 * Consumers need a named import for the former and the synthetic owner for the
 * latter.
 */
@:genes.moduleFunction("mixedSelected")
function mixedSelected(): Int {
  return 1;
}

final mixedOrdinary: Int = 2;
