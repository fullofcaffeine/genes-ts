package refresh;

import genes.react.JSX.*;
import refresh.App;
import refresh.Transitive;
import refresh.Omitted;
import refresh.Cycle;

@:jsRequire("react-dom/client")
extern class ReactDomClient {
  static function createRoot(container: js.html.Element): ReactRoot;
}

extern class ReactRoot {
  function render(element: genes.react.Element): Void;
}

/** Mounts `App` in a browser; does nothing in Node. */
class Main {
  static function main(): Void {
    LoadLog.record("Main:" + appTitle());
    LoadLog.record("Transitive:" + (Holder.cached != null));
    LoadLog.record("Omitted:" + (renderOmitted(2) != null));
    LoadLog.record("Cycle:" + (CycleDep.rendered != null) + ":" + cyclePlain());
    if (js.Syntax.code("typeof document") == "undefined")
      return;
    final container: Null<js.html.Element> = js.Browser.document.getElementById("root");
    if (container != null)
      ReactDomClient.createRoot(container).render(<App />);
  }
}
