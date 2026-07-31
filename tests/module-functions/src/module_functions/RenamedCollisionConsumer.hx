package module_functions;

import module_functions.RenamedCollisionSource.renamedBinding as foreignBinding;

/**
 * The fixed local ESM name differs from the authored Haxe field name.
 *
 * Genes reserves `renamedBinding` before allocating the foreign import, so the
 * aliasable import yields while the explicit public binding remains exact.
 */
@:expose("renamedBinding")
@:genes.moduleFunction("renamedBinding")
function authoredLocalName(): String {
  return "local";
}

function renamedCollisionTranscript(): String {
  return '${authoredLocalName()}:${foreignBinding()}';
}
