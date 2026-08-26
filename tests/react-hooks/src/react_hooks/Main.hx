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

typedef ProjectedCounterView = {
  final value: Int;
  final increment: Void->Void;
  final replace: Int->Void;
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

/** Uses only the semantic state operations that admit native destructuring. */
@:genes.reactHook
function useProjectedCounter(initial: Int): ProjectedCounterView {
  final state = useState(initial);
  final increment = useCallback(() -> state.update(previous -> previous + 1),
    deps());
  final replace = useCallback((next: Int) -> state.set(next), deps());
  return {
    value: state.value,
    increment: increment,
    replace: replace
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
    final projectedCounter = useProjectedCounter;
    final label = useLazyLabel;
    final list = useStringList;
    final computed = useComputedSummary;
    final component = Counter;
    final typeOnlyComponent = TypeOnlyComponent.Identity;
    final optionalTypeOnlyComponent = TypeOnlyComponent.OptionalIdentity;
    final blockEdit = GutenbergBlock.BlockEdit;
    final stateInitialization = StateInitialization.retainStateInitializationProof;
    final typedProjections = StateProjectionCases.useTypedProjections;
    final lazyProjection = StateProjectionCases.useLazyProjection;
    final contextualProjection = StateProjectionCases.useContextualProjection;
    final genericEnumProjection = StateProjectionCases.useGenericEnumProjection;
    final genericProjection: (Int,
      Int) -> Int = StateProjectionCases.useGenericProjection;
    final callableProjection = StateProjectionCases.useCallableProjection;
    final setterOnly = StateProjectionCases.useSetterOnly;
    final stableSetterCallback = StateProjectionCases.useStableSetterCallback;
    final nestedSetterCollision = StateProjectionCases.useNestedSetterCollision;
    final deepNestedSetterCollision = StateProjectionCases.useDeepNestedSetterCollision;
    final switchSetterCollision = StateProjectionCases.useSwitchSetterCollision;
    final projectionNameCollisions = StateProjectionCases.useProjectionNameCollisions;
    final importedSetterCollision = StateProjectionImportCollision.useImportedSetterCollision;
    final moduleSetterCollision = StateProjectionModuleBindingCollision.useModuleSetterCollision;
    final constructorCollision = StateProjectionConstructorCollision.useConstructorCollision;
    final nativeConstructorCollision = StateProjectionNativeCollision.useNativeConstructorCollision;
    final wholeStateFallbacks = StateProjectionFallbacks.useWholeStateFallbacks;
    final opaqueDispatcherFallback = StateProjectionFallbacks.useOpaqueDispatcherFallback;
    final opaqueValueOnlyFallback = StateProjectionFallbacks.useOpaqueValueOnlyFallback;
    final opaqueDescendantFallback = StateProjectionFallbacks.useOpaqueDescendantFallback;
    final opaqueInitializerFallback = StateProjectionFallbacks.useOpaqueInitializerFallback;
    final opaqueSiblingProjection = StateProjectionFallbacks.useOpaqueSiblingProjection;
    final returnedState = StateProjectionFallbacks.useReturnedState;
    final customState = StateProjectionFallbacks.useCustomState;
    final customStateConsumer = StateProjectionFallbacks.useCustomStateConsumer;
    if (counter == null || projectedCounter == null || label == null
      || list == null || computed == null || component == null
      || typeOnlyComponent == null || optionalTypeOnlyComponent == null
      || blockEdit == null || typedProjections == null
      || lazyProjection == null || contextualProjection == null
      || genericEnumProjection == null || genericProjection == null
      || callableProjection == null || setterOnly == null
      || stableSetterCallback == null || nestedSetterCollision == null
      || deepNestedSetterCollision == null || switchSetterCollision == null
      || projectionNameCollisions == null || importedSetterCollision == null
      || moduleSetterCollision == null || constructorCollision == null
      || nativeConstructorCollision == null || wholeStateFallbacks == null
      || returnedState == null || opaqueDispatcherFallback == null
      || opaqueValueOnlyFallback == null || opaqueDescendantFallback == null
      || opaqueInitializerFallback == null
      || opaqueSiblingProjection == null || customState == null
      || customStateConsumer == null || stateInitialization == null) {
      throw "React Hook functions were not retained";
    }
  }
}
