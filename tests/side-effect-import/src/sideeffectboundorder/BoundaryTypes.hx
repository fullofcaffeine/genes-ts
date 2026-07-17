package sideeffectboundorder;

/** First bound module encountered by executable source in the order fixture. */
class BoundaryTypes {
  static final initialized:Int = Events.values.push("boundary");

  public static function touch():Int {
    return initialized;
  }
}
