package lexicalbinding;

/** Direct ESM function used by the lexical runtime-authority fixture. */
@:genes.moduleFunction("setStateFunction")
function setStateFunction(): String {
  return "function";
}

/** Direct ESM value used by the lexical runtime-authority fixture. */
@:genes.moduleValue("setStateValue")
final setStateValue = "value";
