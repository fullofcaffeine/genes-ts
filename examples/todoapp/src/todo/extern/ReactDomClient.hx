package todo.extern;

@:jsRequire("react-dom/client")
extern class ReactDomClient {
  public static function createRoot(container: Dynamic): ReactRoot;
}

extern class ReactRoot {
  public function render(node: Dynamic): Void;
}

