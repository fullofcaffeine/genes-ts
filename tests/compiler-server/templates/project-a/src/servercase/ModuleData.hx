package servercase;

/**
 * Proves that a warm compiler request rebuilds a direct closed value through
 * the same request-local plan as an isolated cold build.
 */
@:genes.moduleValue("moduleLabel")
final moduleLabel = {
  value: "closed-module-data"
};
