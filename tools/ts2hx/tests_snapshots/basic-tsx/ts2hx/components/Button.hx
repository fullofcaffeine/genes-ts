package ts2hx.components;

// TS2HX-MODULES-ESM-RUNTIME-PACKAGE-BOUND-001: assisted output omitted ImportDeclaration at components/Button.tsx:1:1.
typedef ButtonProps = { var label: String; };

function Button(props: ButtonProps): genes.react.Element {
  return genes.react.internal.Jsx.__jsx("button", [], [props.label]);
}
