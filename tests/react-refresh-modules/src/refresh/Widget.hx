package refresh;

import genes.react.Element;
import genes.react.JSX.*;

/**
 * A split module whose class, enum and interface another module
 * (`TypeUser`) uses only as types. `Widget.tsx` re-exports their type side
 * with `export type`, so the type-only import from `Widget.js` still checks.
 */
typedef WidgetProps = {
  final model: Model;
}

/** A public class beside the components. */
class Model implements Named {
  public final name: String;

  public function new(name: String) {
    this.name = name;
  }

  public function label(): String {
    return name;
  }
}

/** A public enum beside the components. */
enum Kind {
  Small;
  Large;
}

/** A public interface beside the components. */
interface Named {
  function label(): String;
}

@:keep
@:genes.reactComponent
function WidgetView(props: WidgetProps): Element {
  return <span data-widget="">{props.model.label()}</span>;
}

@:keep
@:genes.reactComponent
function WidgetFrame(props: WidgetProps): Element {
  return <div><WidgetView model={props.model} /></div>;
}
