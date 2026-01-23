package todo.web;

import js.Syntax;
import todo.extern.ReactDomClient;

class Main {
  static function main() {
    final el: Dynamic = Syntax.code('document.getElementById("root")');
    if (el == null)
      throw "Missing #root";
    ReactDomClient.createRoot(el).render(App.Component());
  }
}
