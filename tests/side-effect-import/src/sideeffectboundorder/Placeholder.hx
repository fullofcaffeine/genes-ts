package sideeffectboundorder;

/** Second bound module encountered by executable source in the order fixture. */
class Placeholder {
  static final initialized:Int = Events.values.push("placeholder");

  public static function touch():Int {
    return initialized;
  }
}
