package tests.regroupidentity;

/**
 * Concrete nullable payload used to prove that an exact Haxe-accepted enum
 * boundary is planned before TypeScript imports are frozen.
 */
enum ConcreteBoundaryStep {
  Concrete(value: Int);
}

/**
 * Ordinary optional field whose missing JavaScript value must first normalize
 * to Haxe `null`, even when it crosses a planned non-null enum boundary.
 */
typedef OptionalBoundarySource = {
  final ?value: Int;
}

/**
 * Two-parameter nominal value used by the incompatible-sibling control.
 */
class BoundaryPair<Left, Right> {
  public final left: Left;
  public final right: Right;

  public function new(left: Left, right: Right) {
    this.left = left;
    this.right = right;
  }
}

/** Small constructor target for a planned nullable argument boundary. */
class ConcreteHolder {
  public final value: Int;

  public function new(value: Int) {
    this.value = value;
  }
}
