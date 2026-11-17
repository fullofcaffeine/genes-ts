package refresh;

import genes.react.Element;
import genes.react.JSX.*;
import refresh.CallbackSupport;

typedef CallbackIfaceProps = {
  final n: Int;
}

/**
 * A static initializer passes a new instance to another module, which calls
 * `render` through an interface. The module stays one file.
 */
class IfaceImpl implements CallbackRender {
  public function new() {}

  public function render(): Element {
    return IfaceBadge({n: 2});
  }
}

class IfaceHolder {
  public static final rendered: Element = CallbackRunner.run(new IfaceImpl());
}

@:genes.reactComponent
function IfaceBadge(props: CallbackIfaceProps): Element {
  return <i data-iface="">{Std.string(props.n)}</i>;
}

/** Keeps the module-fields class, so the component has a slot. */
function ifaceKeep(): Int {
  return 1;
}
