package react_hooks;

import genes.react.Context;
import genes.react.Optimistic;
import genes.react.ReactRef.RefObject;
import genes.react.State;
import genes.react.Element;
import genes.react.JSX.*;
import genes.react.React.deps;
import genes.react.React.useCallback;
import genes.react.React.createContext;
import genes.react.React.useContext;
import genes.react.React.useEffect;
import genes.react.React.useMemo;
import genes.react.React.useOptimistic;
import genes.react.React.useRef;
import genes.react.React.useState;
import genes.react.React.useStateLazy;

typedef CounterView = {
  final value: Int;
  final doubled: Int;
  final increment: Void->Void;
  final optimistic: Optimistic<Int, Int>;
}

typedef CounterProps = {
  final initial: Int;
}

final CounterLabel: Context<String> = createContext("Counter");

/**
 * Generic module Hook with no framework convention or runtime wrapper.
 *
 * `@:genes.reactHook` both enables Haxe placement checks and derives the
 * analyzer-visible module function required by React's official lint.
 */
@:genes.reactHook
function useCounter(initial: Int): CounterView {
  final state: State<Int> = useState(initial);
  final label = useContext(CounterLabel);
  final button: RefObject<js.html.ButtonElement> = useRef((null : Null<js.html.ButtonElement>));
  final value = state.value;
  final doubled = useMemo(() -> value * 2, deps(value));
  final increment = useCallback(() -> state.update(previous -> previous + 1),
    deps(state));
  final optimistic = useOptimistic(value,
    (current: Int, amount: Int) -> current + amount);
  useEffect(() -> {
    final element = button.current;
    if (element != null)
      element.setAttribute("aria-label", label);
  }, deps(button, label));
  useEffect(() -> () -> {
    final element = button.current;
    if (element != null)
      element.removeAttribute("aria-label");
  }, deps(button));
  return {
    value: value,
    doubled: doubled,
    increment: increment,
    optimistic: optimistic
  };
}

/** Creates lazily initialized state without callable-value ambiguity. */
@:genes.reactHook
function useLazyLabel(seed: String): State<String> {
  return useStateLazy(() -> seed);
}

/** Preserves the selected item type when an empty array has no TS evidence. */
@:genes.reactHook
function useStringList(): State<Array<String>> {
  return useState(([] : Array<String>));
}

/**
 * Names computed dependencies once so React sees the same scalar in the
 * calculation body and dependency array.
 *
 * The calculation parameters are compile-time authoring syntax. Genes moves
 * each dependency into one render-local final value and emits React's ordinary
 * zero-argument `useMemo` callback.
 */
@:genes.reactHook
function useComputedSummary(initial: Int, label: String,
    enabled: Bool): String {
  final state = useState(initial);
  return useMemo((current, currentLabel,
      currentEnabled) ->
      currentEnabled ? '$currentLabel:${current * 2}' : currentLabel,
    deps(state.value, label.toUpperCase(), enabled));
}

/** Generic module component consuming the same semantic Hook surface. */
@:genes.reactComponent
function Counter(props: CounterProps): Element {
  final state = useState(props.initial);
  return <button onClick={() -> state.update(value -> value + 1)}>
    Count {state.value}
  </button>;
}

/**
 * Haxe requires a class for `-main`; it only roots the module functions.
 *
 * The React authoring surface itself stays module-native and is never executed
 * outside React during this compiler fixture.
 */
class Main {
  static function main(): Void {
    final counter = useCounter;
    final label = useLazyLabel;
    final list = useStringList;
    final computed = useComputedSummary;
    final component = Counter;
    final typeOnlyComponent = TypeOnlyComponent.Identity;
    final blockEdit = GutenbergBlock.BlockEdit;
    if (counter == null || label == null || list == null
      || computed == null || component == null || typeOnlyComponent == null
      || blockEdit == null) {
      throw "React Hook functions were not retained";
    }
  }
}
