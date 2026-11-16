package inc;

/**
 * The superclass of `inc.CyChild`; its module imports `inc.CyHub` at run
 * time. See "a late member in a module that is never clean closes an import
 * cycle" in the shadow gate.
 */
class CyBase {
  public function new() {}

  public function tag(): String {
    return CyHub.tag();
  }
}
