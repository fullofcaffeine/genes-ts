package refresh;

import genes.react.Element;
import genes.react.JSX.*;

typedef CallbackStringProps = {
  final n: Int;
}

/**
 * `Std.string` calls `toString`, which reads a component while the module
 * loads. The module stays one file.
 */
class StringLabel {
  public function new() {}

  public function toString(): String {
    return Std.string(StringBadge({n: 9}) != null);
  }
}

class StringHolder {
  public static final text: String = Std.string(new StringLabel());
}

@:genes.reactComponent
function StringBadge(props: CallbackStringProps): Element {
  return <i data-string="">{Std.string(props.n)}</i>;
}

/** Keeps the module-fields class, so the component has a slot. */
function stringKeep(): Int {
  return 1;
}
