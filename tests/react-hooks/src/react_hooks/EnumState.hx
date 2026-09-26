package react_hooks;

import genes.react.Element;
import genes.react.State;
import genes.react.React.useState;

/** A closed value domain whose implementation fields may disappear under DCE. */
enum abstract DisplayMode(String) to String {
  final Document = "document";
  final Canvas = "canvas";
}

typedef EnumStateProps = {
  final ?initial: DisplayMode;
  final ?replacement: DisplayMode;
}

typedef ChoiceProps<T> = {
  final value: T;
  final label: String;
  final onChange: T->Void;
}

/** The generic callback independently requires the exact value type. */
@:genes.reactComponent
function Choice<T>(props: ChoiceProps<T>): Element {
  return
    <button onClick={_ -> props.onChange(props.value)}>{props.label}</button>;
}

/** Proves optional-prop initialization, projected reads, and React replacement. */
@:genes.reactComponent
function EnumControl(props: EnumStateProps): Element {
  final state: State<DisplayMode> = useState(props.initial ?? DisplayMode.Canvas);
  final mode: DisplayMode = state.value;
  function select(next: DisplayMode): Void {
    state.set(next);
  }
  if (props.replacement != null && mode != props.replacement)
    select(props.replacement);
  return <Choice value={mode} label={mode} onChange={select} />;
}

/** A later unrestricted string write must prevent enum-domain refinement. */
@:genes.reactHook
function useBroadLabel(initial: DisplayMode, replacement: String): String {
  final state = useState(initial);
  var label: String = state.value;
  if (replacement.length > 0)
    label = replacement;
  return label;
}
