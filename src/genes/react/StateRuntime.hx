package genes.react;

/**
 * Internal bridge for replacing function-valued React state.
 *
 * React treats a function passed to its dispatcher as an updater. Wrapping a
 * callable replacement in a constant updater preserves eager, exactly-once
 * evaluation without weakening the public state type.
 */
@:noCompletion
function replaceCallable<Value>(
    dispatch: Dispatch<SetStateAction<Value>>, next: Value): Void {
  dispatch(_previous -> next);
}
