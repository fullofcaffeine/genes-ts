package ts2hx.components;

typedef ButtonProps = { var label: String; };

function Button(props: ButtonProps): genes.react.Element {
  return genes.react.internal.Jsx.__jsx("button", [], [props.label]);
}
