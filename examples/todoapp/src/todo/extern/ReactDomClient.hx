package todo.extern;

import js.html.Element;
import todo.web.ReactTypes.ReactElement;

@:jsRequire("react-dom/client")
extern class ReactDomClient {
  public static function createRoot(container: Element): ReactRoot;
}

extern class ReactRoot {
  public function render(node: ReactElement): Void;
}
