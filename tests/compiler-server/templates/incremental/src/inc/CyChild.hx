package inc;

/**
 * Its emission asks whether the module of its superclass is in an import
 * cycle with it (`Module.isCyclic`): in a cycle, Genes prints a lazy
 * `Register.inherits(() => CyBase, true)`.
 */
class CyChild extends CyBase {
  public function new() {
    super();
  }

  public function name(): String {
    return "child:" + tag();
  }
}
