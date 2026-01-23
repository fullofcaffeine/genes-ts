package todo.extern;

import haxe.DynamicAccess;
import js.lib.Promise;
import js.Syntax;

typedef FetchHeaders = DynamicAccess<String>;

typedef FetchRequestInit = {
  var method: String;
  var headers: FetchHeaders;
  @:optional var body: String;
}

typedef FetchResponse = {
  var ok: Bool;
  var status: Int;
  function json<T>(): Promise<T>;
}

class Fetch {
  public static function fetch(url: String,
      init: FetchRequestInit): Promise<FetchResponse> {
    return cast Syntax.code("fetch({0}, {1})", url, init);
  }
}
