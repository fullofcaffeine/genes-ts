package todo.web;

import genes.react.JSX.*;
import js.Syntax;
import todo.extern.ReactDomClient;
import todo.web.ReactTypes.ReactComponent;

@:jsx_inline_markup
class Main {
  static function main() {
    final el: Dynamic = Syntax.code('document.getElementById("root")');
    if (el == null)
      throw "Missing #root";
    final AppComponent: ReactComponent = App.Component;
    ReactDomClient.createRoot(el).render(<AppComponent />);
  }
}
