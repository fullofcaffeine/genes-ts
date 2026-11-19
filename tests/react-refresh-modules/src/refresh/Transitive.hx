package refresh;

import genes.react.Element;
import genes.react.JSX.*;

typedef TransitiveProps = {
  final count: Int;
}

/**
 * A static initializer reaches a component through a helper call. The
 * module stays one file: in a split module the helper would call the
 * placeholder slot while the sibling loads.
 */
class Holder {
  public static final cached: Element = make();
}

function make(): Element {
  return TransitiveBadge({count: 1});
}

@:genes.reactComponent
function TransitiveBadge(props: TransitiveProps): Element {
  return <i data-transitive="">{Std.string(props.count)}</i>;
}
