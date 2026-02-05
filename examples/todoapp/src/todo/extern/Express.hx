package todo.extern;

/**
 * Minimal Express externs for the todoapp example.
 *
 * Why:
 * - The todoapp is meant to showcase genes-ts output and interop patterns, not
 *   ship/maintain a full Haxe Express binding.
 * - Express already ships excellent TypeScript types; we want the generated
 *   `.ts` output to refer to those canonical types.
 *
 * What:
 * - We declare the smallest extern surface the example needs (routing + JSON +
 *   static hosting).
 *
 * How:
 * - `@:jsRequire("express")` ensures the emitted TS/JS imports Express.
 * - `@:ts.type("import('express').X")` pins the generated TS types to Express'
 *   real typing definitions (no “fake” Haxe-side re-declarations).
 */

import haxe.Constraints.Function;
import haxe.DynamicAccess;

@:jsRequire("express")
extern class Express {
  @:selfCall public static function call(): ExpressApp;

  public static function json(): Function;

  @:native("static") public static function static_(root: String): Function;
}

typedef ExpressHandler = (req: ExpressRequest, res: ExpressResponse) -> Void;

/**
 * Express application interface.
 *
 * `@:ts.type(...)` is critical here:
 * - It makes the generated TS refer to the real `express.Application` type.
 * - This keeps the example idiomatic for TS consumers and avoids `any`.
 */
@:ts.type("import('express').Application")
typedef ExpressApp = {
  function use(middleware: Function): Void;
  function get(path: String, handler: ExpressHandler): Void;
  function post(path: String, handler: ExpressHandler): Void;
  function patch(path: String, handler: ExpressHandler): Void;
  function delete(path: String, handler: ExpressHandler): Void;
  function listen(port: Int, cb: Void->Void): Void;
};

/**
 * Request object (subset).
 *
 * Notes:
 * - We keep `params` as a `DynamicAccess<String>` because Express exposes it as a
 *   string-keyed bag.
 * - `body` is still a dynamic bag because JSON payloads vary by route; each
 *   handler casts into the specific API type it expects.
 */
@:ts.type("import('express').Request")
typedef ExpressRequest = {
  var params: DynamicAccess<String>;
  var body: DynamicAccess<Dynamic>;
  var path: String;
  var method: String;
};

/**
 * Response object (subset).
 *
 * Typed fluent interface so code stays ergonomic and TS output stays typed.
 */
@:ts.type("import('express').Response")
typedef ExpressResponse = {
  function status(code: Int): ExpressResponse;
  function set(name: String, value: String): ExpressResponse;
  function json(body: {}): ExpressResponse;
  function send(body: String): ExpressResponse;
};
