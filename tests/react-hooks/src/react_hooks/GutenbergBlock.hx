package react_hooks;

import genes.react.Element;
import genes.react.JSX.*;
import genes.react.React.useState;

typedef BlockAttributes = {
  final title: String;
}

typedef BlockEditProps = {
  final attributes: BlockAttributes;
}

/**
 * Gutenberg-shaped consumer proving that the React contract is host-neutral.
 *
 * No WordPress package or convention is required: an integration can pass its
 * ordinary typed block props into the same React component and Hook surface.
 */
@:genes.reactComponent
function BlockEdit(props: BlockEditProps): Element {
  final selected = useState(false);
  return <button
    aria-pressed={selected.value}
    onClick={() -> selected.update(value -> !value)}
  >{props.attributes.title}</button>;
}
