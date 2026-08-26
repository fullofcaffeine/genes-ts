package react_hooks;

import genes.react.React.useState;

@:genes.moduleFunction("setState")
function setState(scope: Void->Void): Void {
  scope();
}

/** A descendant direct-module call remains distinct from the outer setter. */
@:genes.reactHook
function useModuleSetterCollision(initial: Int): Void->Void {
  final state = useState(initial);
  return () -> {
    state.set(initial + 1);
    setState(() -> if (initial < 0) throw "negative module setter seed");
  };
}
