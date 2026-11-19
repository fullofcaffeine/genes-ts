package refresh;

import genes.react.Element;
import genes.react.JSX.*;

typedef LabelProps = {
  final text: String;
}

/** A component that a static initializer reads while the module loads. */
@:genes.reactComponent
function Label(props: LabelProps): Element {
  return <em data-label="">{props.text}</em>;
}

/**
 * `defaultView` reads `Label` during module load, so Genes keeps this module
 * as one file: a split sibling would read the slot before it is set.
 */
class Registry {
  public static final defaultView: LabelProps->Element = Label;
}
