package pk;

import genes.react.Element;
import genes.react.JSX.*;

private typedef HiddenProps = {
  final label: String;
}

@:jsRequire("./widget-status.js", "WidgetStatus")
@:genes.jsxComponentProps("pk.Widgets.HiddenProps")
extern class WidgetStatus {}

@:genes.reactComponent
function WidgetView(props: {final value: String;}): Element {
  return <div><WidgetStatus label={props.value} /></div>;
}
