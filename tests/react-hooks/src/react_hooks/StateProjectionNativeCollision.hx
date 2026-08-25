package react_hooks;

import genes.react.React.useState;

@:native("setState")
private extern class NativeState {
  public function new();
}

/** A direct host-global constructor cannot be hidden by a dispatcher. */
@:genes.reactHook
function useNativeConstructorCollision(initial: Int): NativeState {
  final state = useState(initial);
  state.set(initial + 1);
  return new NativeState();
}
