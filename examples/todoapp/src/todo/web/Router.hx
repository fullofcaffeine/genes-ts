package todo.web;

import todo.extern.ReactRouterDom.Params;
import todo.extern.ReactRouterDom.useParams;

class Router {
  public static function param(name: String): Null<String> {
    final params: Params = useParams();
    return params.get(name);
  }
}
