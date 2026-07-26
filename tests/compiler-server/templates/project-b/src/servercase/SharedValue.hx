package servercase;

/** Project B gives the same module identity a different public field type. */
class SharedValue {
  public final count: Int;

  public function new(count: Int) {
    this.count = count;
  }
}
