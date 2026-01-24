package todo.extern;

// Minimal Express externs for the todoapp example.
// Keep this small and TS-first: most typing comes from the imported TS types.

import haxe.Constraints.Function;
import haxe.DynamicAccess;

@:jsRequire("express")
extern class Express {
  @:selfCall public static function call(): ExpressApp;

  public static function json(): Function;

  @:native("static") public static function static_(root: String): Function;
}

typedef ExpressHandler = (req: ExpressRequest, res: ExpressResponse) -> Void;

@:ts.type("import('express').Application")
typedef ExpressApp = {
  function use(middleware: Function): Void;
  function get(path: String, handler: ExpressHandler): Void;
  function post(path: String, handler: ExpressHandler): Void;
  function patch(path: String, handler: ExpressHandler): Void;
  function delete(path: String, handler: ExpressHandler): Void;
  function listen(port: Int, cb: Void->Void): Void;
};

@:ts.type("import('express').Request")
typedef ExpressRequest = {
  var params: DynamicAccess<String>;
  var body: DynamicAccess<Dynamic>;
  var path: String;
  var method: String;
};

@:ts.type("import('express').Response")
typedef ExpressResponse = {
  function status(code: Int): ExpressResponse;
  function set(name: String, value: String): ExpressResponse;
  function json(body: {}): ExpressResponse;
  function send(body: String): ExpressResponse;
};
