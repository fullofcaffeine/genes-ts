package genes.react;

#if macro
import haxe.macro.Expr.ExprOf;
#end

/**
 * Allocation-free, intent-oriented view of React state.
 *
 * `value`, `set`, and `update` separate replacement from updater intent. The
 * abstract erases to React's existing tuple and allocates no wrapper object.
 */
abstract State<Value>(UseStateResult<Value>) {
  /** Current render's state value. */
  public var value(get, never): Value;

  inline function get_value(): Value {
    return this.first;
  }

  /**
   * Replaces the state value.
   *
   * Possibly callable replacements use React's constant-updater form so a
   * stored function is not accidentally invoked as an updater.
   */
  public macro function set<Value>(state: ExprOf<State<Value>>,
      next: ExprOf<Value>): ExprOf<Void> {
    return genes.react.ReactHooksMacro.setState(state, next);
  }

  /** Applies a transition to the previous value. */
  public inline function update(reducer: Value->Value): Void {
    this.second(reducer);
  }

  @:noCompletion
  private inline function __setDirect(next: Value): Void {
    this.second(next);
  }

  @:noCompletion
  private inline function __setPossiblyCallable(next: Value): Void {
    StateRuntime.replaceCallable(this.second, next);
  }
}
