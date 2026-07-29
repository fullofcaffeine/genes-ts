package enumconstructors;

/**
 * Generic value that uses `T` in both input and output positions.
 *
 * This makes the generated TypeScript parameter invariant: a value whose type
 * is `Choice<A, never>` cannot silently stand in for `Choice<A, B>`.
 */
class InvariantValue<T> {
  public final value: T;
  public final replace: T->T;

  public function new(value: T) {
    this.value = value;
    this.replace = next -> next;
  }
}
