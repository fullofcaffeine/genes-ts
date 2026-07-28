package react_hooks;

import genes.react.React.deps;
import genes.react.React.useMemo;
import genes.react.React.useState;

/**
 * Negative controls for typed memo dependency snapshots.
 *
 * Each define selects one invalid source shape so the harness can prove the
 * diagnostic at the authored Haxe call without weakening the valid cases.
 */
@:genes.reactHook
function useInvalidMemo(value: Int): Int {
  #if react_memo_snapshot_arity
    return useMemo((current, extra) -> current + extra, deps(value));
  #elseif react_memo_snapshot_named
    return useMemo(function calculate(current: Int): Int {
      return current * 2;
    }, deps(value));
  #elseif react_memo_snapshot_rest
    return useMemo(function(...current: Int): Int {
      return value;
    }, deps(value));
  #elseif react_memo_snapshot_type
    return useMemo((current: String) -> current.length, deps(value));
  #else
    final state = useState(value);
    return useMemo(() -> state.value * 2, deps(state.value));
  #end
}

/** Roots the selected negative Hook without adding an application runtime. */
class MemoSnapshotNegative {
  static function main(): Void {
    final invalid = useInvalidMemo;
    if (invalid == null) throw "negative control was not retained";
  }
}
