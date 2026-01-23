package todo.web;

import todo.extern.ReactRouterDom.useParams;

class Router {
  public static function param(name: String): Null<String> {
    final params: Dynamic = useParams();
    return cast Reflect.field(params, name);
  }
}

