package refresh;

import genes.react.Element;
import genes.react.JSX.*;

/** Only components and types: this module is not split. */
typedef GreetingProps = {
  final name: String;
}

@:genes.reactComponent
function Greeting(props: GreetingProps): Element {
  return <p data-greeting="">Hello {props.name}</p>;
}
