package todo.web;

import genes.react.JSX.*;
import js.Syntax;
import todo.extern.ReactDomClient;

@:jsx_inline_markup
class Main {
  static function main() {
    final el: Dynamic = Syntax.code('document.getElementById("root")');
    if (el == null)
      throw "Missing #root";
    final AppComponent: Dynamic = App.Component;
    ReactDomClient.createRoot(el).render(<AppComponent />);
  }
}
