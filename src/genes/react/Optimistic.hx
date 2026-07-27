package genes.react;

/**
 * Allocation-free, intent-oriented view of React optimistic state.
 *
 * The abstract erases to React's tuple. `value` reads the projection and
 * `apply` dispatches one exactly typed action.
 */
abstract Optimistic<State, Action>(UseOptimisticResult<State, Action>) {
  public var value(get, never): State;

  inline function get_value(): State {
    return this.first;
  }

  public inline function apply(action: Action): Void {
    this.second(action);
  }
}
