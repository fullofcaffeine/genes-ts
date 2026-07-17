/**
 * Models a recursive generic API whose next node changes its type argument.
 * The semantic gate must inspect this declaration once without unrolling an
 * infinite family of `ExpandingNode<{ value: ... }>` instantiations.
 */
export interface ExpandingNode<T> {
  readonly value: T;
  readonly next: ExpandingNode<{ readonly value: T }> | null;
}
