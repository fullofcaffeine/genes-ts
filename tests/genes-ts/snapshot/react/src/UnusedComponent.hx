import genes.react.Element;
import genes.react.JSX.*;

/**
 * Deliberately unreferenced component proving that the React marker is not a
 * dead-code-elimination root.
 */
@:genes.reactComponent
function UnusedComponent(): Element {
  return <aside>Not retained</aside>;
}
