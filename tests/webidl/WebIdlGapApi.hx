package tests.webidl;

/** Keeps `WebIdlGapSurface` reachable from the public declaration graph. */
class WebIdlGapApi {
  public function new() {}

  /**
   * Returns no browser value because the compiler suite executes in Node; the
   * return type itself is the declaration contract under test.
   */
  public function surface(): Null<WebIdlGapSurface> {
    return null;
  }
}
