package refresh;

import genes.react.Element;
import genes.react.JSX.*;
import refresh.Panel.formatCount;

/**
 * Only components and types: this module is not split. It uses only a
 * non-component function of the split module `Panel`, so it imports
 * `Panel.js` for its side effect and `formatCount` from `Panel.fields.js`.
 */
typedef GreetingProps = {
  final name: String;
}

@:genes.reactComponent
function Greeting(props: GreetingProps): Element {
  return <p data-greeting="">Hello {props.name} {formatCount(1)}</p>;
}
