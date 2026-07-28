package todo.web;

import todo.extern.ReactRouter.Params;
import todo.extern.ReactRouter.useParams;

class Router {
  @:genes.reactHook
  public static function useParam(name: String): Null<String> {
    final params: Params = useParams();
    return params.get(name);
  }
}
