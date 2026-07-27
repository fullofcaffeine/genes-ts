package template_late;

/**
 * Supplies an unrelated planning error after dependency expansion.
 *
 * The template-literal diagnostic must win before this module reaches
 * implementation preflight. If this error wins instead, the late-added type
 * had no executable marker to validate. `@:genes.moduleFunction` normally
 * moves an eligible static method to module scope; applying it to this instance
 * method deliberately requests an unsupported shape and produces the stable
 * control diagnostic used to observe planning order.
 */
class ALateBlocker {
  public function new() {}

  @:genes.moduleFunction("invalidInstanceFunction")
  public function invalidInstanceFunction():String {
    return "unreachable";
  }
}
