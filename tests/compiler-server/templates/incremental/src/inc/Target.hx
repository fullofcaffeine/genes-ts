package inc;

/** Reached by `User` only by inference through `Source`. */
class Target {
  public function new() {}

  public function name(): String {
    return "target-v1";
  }
}
