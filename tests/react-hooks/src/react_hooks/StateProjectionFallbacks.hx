package react_hooks;

import genes.react.React.useState;
import genes.react.State;
import genes.react.UseStateResult;

typedef StoredState = {
  final state: State<Int>;
}

function readState(state: State<Int>): Int {
  return state.value;
}

function identity<Value>(value: Value): Value {
  return value;
}

/** Whole-State aliases, calls, storage, casts, and reflection stay unprojected. */
@:genes.reactHook
function useWholeStateFallbacks(initial: Int): Int {
  final aliasedState = useState(initial);
  final alias = aliasedState;

  final passedState = useState(initial + 1);
  final passed = readState(passedState);

  final storedState = useState(initial + 2);
  final stored: StoredState = {state: storedState};

  final castState = useState(initial + 3);
  final casted: UseStateResult<Int> = cast castState;

  final identityState = useState(initial + 4);
  final identical = identity(identityState);

  final reflectedState = useState(initial + 5);
  final reflected = Reflect.field(reflectedState, "0");

  final dynamicState = useState(initial + 6);
  final widened: Dynamic = dynamicState;

  final tupleState = useState(initial + 7);
  final tuple: UseStateResult<Int> = cast tupleState;
  tuple.first = initial;

  final opaqueState = useState(initial + 8);
  final opaque: Int = js.Syntax.code("{0}", opaqueState.value);

  return alias.value
    + passed
    + stored.state.value
    + casted.first
    + identical.value
    + Std.int(reflected)
    + Std.int(widened[0])
    + tuple.first
    + opaque;
}

/** Returning the State itself keeps the public semantic abstraction. */
@:genes.reactHook
function useReturnedState(initial: Int): State<Int> {
  final state = useState(initial);
  return state;
}

/** A custom tuple-shaped Hook does not inherit compiler-owned provenance. */
@:genes.reactHook
function useCustomState(initial: Int): State<Int> {
  return useState(initial);
}

@:genes.reactHook
function useCustomStateConsumer(initial: Int): Int {
  final state = useCustomState(initial);
  return state.value;
}
