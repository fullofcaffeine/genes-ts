package refresh;

/** Calls `Cycle.cycleRender` while it loads; `Cycle` imports this module. */
class CycleDep {
  public static var rendered: Null<genes.react.Element> = null;

  static function __init__() {
    rendered = Cycle.cycleRender();
  }

  public static function value(): Int {
    return 1;
  }
}
