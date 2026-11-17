package refresh;

import genes.react.Element;
import genes.react.JSX.*;

typedef OmittedProps = {
  final n: Int;
}

/**
 * Every field is a direct function, so Genes omits `Omitted_Fields_`. A
 * split sibling would have no slot to read the component through, so the
 * module stays one file.
 */
@:genes.moduleFunction("renderOmitted")
function renderOmitted(n: Int): Element {
  return <OmittedBadge n={n} />;
}

@:genes.reactComponent
function OmittedBadge(props: OmittedProps): Element {
  return <b data-omitted="">{Std.string(props.n)}</b>;
}
