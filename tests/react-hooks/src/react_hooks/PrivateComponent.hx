package react_hooks;

import genes.react.Element;
import genes.react.React.useState;

typedef PrivateComponentProps = {
  final title: String;
}

/** The public component composes a module-private component with real hooks. */
@:genes.reactComponent
function PublicNote(props: PrivateComponentProps): Element {
  return <PrivateNote title={props.title} />;
}

@:genes.reactComponent
private function PrivateNote(props: PrivateComponentProps): Element {
  final title = useState(props.title);
  return <article>{title.value}</article>;
}
