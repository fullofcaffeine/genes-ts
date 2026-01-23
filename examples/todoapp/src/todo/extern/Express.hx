package todo.extern;

// Minimal Express externs for the todoapp example.
// Keep this small and TS-first: most typing comes from the imported TS types.

@:jsRequire("express")
extern class Express {
  @:selfCall public static function call(): ExpressApp;

  public static function json(): Dynamic;

  @:native("static") public static function static_(root: String): Dynamic;
}

typedef ExpressHandler = (req: ExpressRequest, res: ExpressResponse) -> Void;

typedef ExpressApp = {
  function use(middleware: Dynamic): Void;
  function get(path: String, handler: ExpressHandler): Void;
  function post(path: String, handler: ExpressHandler): Void;
  function patch(path: String, handler: ExpressHandler): Void;
  function delete(path: String, handler: ExpressHandler): Void;
  function listen(port: Int, cb: Void->Void): Void;
};

typedef ExpressRequest = {
  var params: Dynamic;
  var body: Dynamic;
  var path: String;
  var method: String;
};

typedef ExpressResponse = {
  function status(code: Int): ExpressResponse;
  function set(name: String, value: String): ExpressResponse;
  function json(body: Dynamic): ExpressResponse;
  function send(body: Dynamic): ExpressResponse;
};
