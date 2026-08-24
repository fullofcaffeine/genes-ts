package react_hooks;

import genes.react.State;
import genes.react.React.useState;
import genes.react.React.useStateLazy;
import genes.react.React.deps;
import genes.react.React.useCallback;
import react_hooks.StateInitializationTypes.Animal;
import react_hooks.StateInitializationTypes.Cat;
import react_hooks.StateInitializationTypes.Choice;
import react_hooks.StateInitializationTypes.Dog;

enum ProjectionMode {
  Idle;
  Active(label: String);
}

typedef ProjectionRecord = {
  final count: Int;
  final label: String;
}

typedef ProjectionValues = {
  final nullable: Null<String>;
  final record: ProjectionRecord;
  final mode: ProjectionMode;
}

/** Proves contextual, record, and enum state keep their exact value types. */
@:genes.reactHook
function useTypedProjections(initial: Null<String>,
    count: Int): ProjectionValues {
  final nullable = useState(initial);
  nullable.update(_previous -> null);

  final initialRecord: ProjectionRecord = {count: count, label: "ready"};
  final record = useState(initialRecord);
  record.update(previous -> {
    count: previous.count + 1,
    label: previous.label
  });

  final mode = useState(ProjectionMode.Idle);
  mode.set(ProjectionMode.Active("running"));

  return {
    nullable: nullable.value,
    record: record.value,
    mode: mode.value
  };
}

/** Proves lazy initialization stays inside React's one initializer callback. */
@:genes.reactHook
function useLazyProjection(seed: String): String {
  final state = useStateLazy(() -> seed.toUpperCase());
  state.update(previous -> previous + "!");
  return state.value;
}

/** The initialization plan keeps a projected local's wider value type. */
@:genes.reactHook
function useContextualProjection(makeCat: Void->Cat, dog: Dog): Animal {
  final state: State<Animal> = useStateLazy(() -> makeCat());
  state.set(dog);
  return state.value;
}

/** Projection reuses the fully closed generic-enum initialization witness. */
@:genes.reactHook
function useGenericEnumProjection(): Choice<Int, String> {
  final state: State<Choice<Int, String>> = useState(Choice.Left(1));
  state.set(Choice.Right("ready"));
  return state.value;
}

/** Proves generic replacement preserves the callable-safe replacement path. */
@:genes.reactHook
function useGenericProjection<Value>(initial: Value,
    replacement: Value): Value {
  final state = useStateLazy(() -> initial);
  state.set(replacement);
  return state.value;
}

/** Proves callable replacement evaluates the replacement expression once. */
@:genes.reactHook
function useCallableProjection(seed: Int): Void->Void {
  final state = useStateLazy(() -> () -> {
    if (seed < 0)
      throw "negative initial callback seed";
  });
  state.set(makeCallback(seed));
  return state.value;
}

function makeCallback(seed: Int): Void->Void {
  return () -> {
    if (seed < 0)
      throw "negative callback seed";
  };
}

/** Proves a setter-only State can omit the unused current-value binding. */
@:genes.reactHook
function useSetterOnly(initial: Int): Int->Void {
  final state = useState(initial);
  return next -> state.set(next);
}

/** Proves React lint recognizes the projected dispatcher as a stable setter. */
@:genes.reactHook
function useStableSetterCallback(initial: Int): Int->Void {
  final state = useState(initial);
  return useCallback(next -> state.set(next), deps());
}

/** A nested parameter cannot shadow the captured synthetic dispatcher. */
@:genes.reactHook
function useNestedSetterCollision(initial: Int): (Int->Void)->Void {
  final state = useState(initial);
  return setState -> {
    state.set(initial + 1);
    setState(initial + 2);
  };
}

/** Every intervening closure reserves the dispatcher captured below it. */
@:genes.reactHook
function useDeepNestedSetterCollision(initial: Int): (Int->Void)->(Void->Void) {
  final state = useState(initial);
  return setState -> () -> {
    state.set(initial + 3);
    setState(initial + 4);
  };
}

/** Proves generated dispatcher names cannot collide with nearby Haxe locals. */
@:genes.reactHook
function useProjectionNameCollisions(initial: Int): Int {
  final setState = initial + 1;
  final state = useState(initial);
  state.set(setState);

  final later = useState(initial + 2);
  final setLater = state.value;
  later.set(setLater);
  return state.value + later.value;
}
