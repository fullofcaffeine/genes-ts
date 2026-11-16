package inc;

/** `rare` is removed by dead-code elimination until a module calls it. */
class Base {
  public function new() {}

  public function common(): String {
    return "base-common";
  }

  public function rare(): String {
    return "base-rare";
  }
}
