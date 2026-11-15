package pk;

import genes.react.Element;
import genes.react.JSX.*;

private typedef HiddenProps = {
  final other: Int;
}

@:jsRequire("./other-status.js", "OtherStatus")
@:genes.jsxComponentProps("pk.Other.HiddenProps")
extern class OtherStatus {}

@:genes.reactComponent
function OtherView(props: {final count: Int;}): Element {
  return <div><OtherStatus other={props.count} /></div>;
}
