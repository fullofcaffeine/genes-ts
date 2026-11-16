package inc;

/**
 * Never constructed: it reaches TypeScript output only through a type
 * position, as a declaration that the generator adds late.
 */
class TypeOnly {
  public final value: Int;

  public function new() {
    value = 1;
  }
}
