package inc;

import genes.react.Element;
import genes.react.JSX.*;
import inc.Widgets.WidgetStatus;

/** HXX markup, with a component whose props type is named by a string. */
class Ui {
  public static function render(label: String): Element {
    return
      <section className="ui-v1"><span>{label}</span><WidgetStatus label={label} /></section>;
  }
}
