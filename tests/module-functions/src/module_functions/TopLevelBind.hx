package module_functions;

/**
 * Proves that omitting a synthetic module owner does not also omit helpers
 * required by the relocated function body.
 */
@:genes.moduleFunction("extractTopLevelValue")
function extractTopLevelValue(receiver: TopLevelReceiver): () -> Int {
  return receiver.value;
}
