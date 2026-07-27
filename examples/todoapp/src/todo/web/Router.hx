package todo.web;

import todo.extern.ReactRouter.Params;
import todo.extern.ReactRouter.useParams;

class Router {
  public static function param(name: String): Null<String> {
    final params: Params = useParams();
    return params.get(name);
  }
}
