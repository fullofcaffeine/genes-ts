package react_hooks;

import genes.react.React.useState;

/** An import binding whose local name can collide with a generated setter. */
@:jsRequire("./state-setter.js", "setState")
private extern function setState(scope: Void->Void): Void;

/** A projected dispatcher cannot shadow a referenced ESM import binding. */
@:genes.reactHook
function useImportedSetterCollision(initial: Int): Void {
  final state = useState(initial);
  state.set(initial + 1);
  setState(() -> if (initial < 0) throw "negative imported setter seed");
}
