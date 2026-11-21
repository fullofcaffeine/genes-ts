package refresh;

import genes.react.JSX.*;
import refresh.App;
import refresh.Transitive;
import refresh.Omitted;
import refresh.Cycle;
import refresh.CallbackIface;
import refresh.CallbackSuper;
import refresh.CallbackString;
import refresh.Lazy.LazyEntry;
import refresh.TypeUser;

@:jsRequire("react-dom/client")
extern class ReactDomClient {
  static function createRoot(container: js.html.Element): ReactRoot;
}

extern class ReactRoot {
  function render(element: genes.react.Element): Void;
}

/** Mounts `App` in a browser; does nothing in Node. */
class Main {
  /**
   * Loads the split module `Lazy` with a dynamic import and passes the
   * element that it makes to `onLoaded` (the probe renders it).
   */
  @:keep
  public static function loadLazy(onLoaded: genes.react.Element->Void): Void {
    genes.Genes.dynamicImport(LazyEntry -> {
      onLoaded(LazyEntry.render());
    });
  }

  static function main(): Void {
    LoadLog.record("Main:" + appTitle());
    LoadLog.record("Transitive:" + (Holder.cached != null));
    LoadLog.record("Omitted:" + (renderOmitted(2) != null));
    LoadLog.record("Cycle:" + (CycleDep.rendered != null) + ":" + cyclePlain());
    LoadLog.record("Callbacks:" + (IfaceHolder.rendered != null) + ":"
      + (SuperHolder.child.element != null) + ":" + StringHolder.text + ":"
      + (ifaceKeep() + superKeep() + stringKeep()));
    if (js.Syntax.code("typeof document") == "undefined")
      return;
    final container: Null<js.html.Element> = js.Browser.document.getElementById("root");
    if (container != null)
      ReactDomClient.createRoot(container).render(<App />);
  }
}
