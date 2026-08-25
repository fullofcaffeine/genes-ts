package react_hooks;

import genes.react.React.useState;

@:genes.importAlias("setState")
@:jsRequire("./state-constructor.js", "setState")
private extern class ImportedStateConstructor {
  public function new();
}

/** An imported constructor remains distinct from the projected dispatcher. */
@:genes.reactHook
function useConstructorCollision(initial: Int): ImportedStateConstructor {
  final state = useState(initial);
  state.set(initial + 1);
  return new ImportedStateConstructor();
}
