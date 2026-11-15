package inc;

import genes.react.Element;
import genes.react.JSX.*;

/** A component; a call of `Date.now` in it fails the React audit after typing. */
@:keep
@:genes.reactComponent
function Clock(props: {final label: String;}): Element {
  return <span>{props.label + Std.string(/*IMPURE*/0)}</span>;
}
