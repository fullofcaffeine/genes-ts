import genes.react.Element;
import genes.react.JSX.*;

/** Proves that a zero-prop module component uses the same direct contract. */
@:genes.reactComponent
function Welcome(): Element {
  return <p data-component="welcome">Ready</p>;
}
