package module_functions;

/** Fixed direct binding used to prove a later Haxe local cannot create a TDZ. */
@:genes.moduleFunction("shadowedDirect")
function shadowedDirect(): String {
  return "direct";
}

function laterLocalTranscript(): String {
  final before = shadowedDirect();
  final shadowedDirect = "local";
  return '$before:$shadowedDirect';
}

/**
 * The requested binding is known before the function parameter is allocated.
 */
@:expose("selectedParameter")
@:genes.moduleFunction("selectedParameter")
function authoredParameterFunction(): String {
  return "direct";
}

function parameterTranscript(selectedParameter: String): String {
  return '${authoredParameterFunction()}:$selectedParameter';
}

/** Fixed name that also matches Haxe's first generated loop local. */
@:genes.moduleFunction("_g")
function _g(): String {
  return "direct";
}

function generatedLocalTranscript(values: Array<Int>): String {
  final before = _g();
  var total = 0;
  for (value in values)
    total += value;
  return '$before:$total';
}
