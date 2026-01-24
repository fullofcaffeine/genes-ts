package todo.web;

import genes.react.JSX.*;
import js.Browser;
import todo.extern.ReactDomClient;
import todo.web.ReactTypes.ReactComponent;

@:jsx_inline_markup
class Main {
  static function main() {
    final el: Null<js.html.Element> = Browser.document.getElementById("root");
    if (el == null)
      throw "Missing #root";
    final AppComponent: ReactComponent = App.Component;
    ReactDomClient.createRoot(el).render(<AppComponent />);
  }
}
