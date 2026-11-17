package refresh;

import genes.react.Element;
import genes.react.JSX.*;
import refresh.CallbackSupport;

typedef CallbackSuperProps = {
  final n: Int;
}

/**
 * The parent constructor in another module calls the override `setup`,
 * which reads a component while the module loads. The module stays one file.
 */
class SuperChild extends CallbackBase {
  public var element: Null<Element> = null;

  public function new() {
    super();
  }

  override function setup(): Void {
    element = SuperBadge({n: 3});
  }
}

class SuperHolder {
  public static final child: SuperChild = new SuperChild();
}

@:genes.reactComponent
function SuperBadge(props: CallbackSuperProps): Element {
  return <i data-super="">{Std.string(props.n)}</i>;
}

/** Keeps the module-fields class, so the component has a slot. */
function superKeep(): Int {
  return 1;
}
