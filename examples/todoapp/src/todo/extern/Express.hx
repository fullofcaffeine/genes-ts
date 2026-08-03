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
import genes.ts.Unknown;

@:jsRequire("express")
extern class Express {
  @:selfCall public static function call(): ExpressApp;

  public static function json(?options: ExpressJsonOptions): Function;

  @:native("static") public static function static_(root: String): Function;
}

/** Options used by the Todoapp's JSON parser boundary. */
typedef ExpressJsonOptions = {
  final strict: Bool;
};

typedef ExpressHandler = (req: ExpressRequest, res: ExpressResponse) -> Void;

/**
 * Express' four-argument error-handler shape.
 *
 * Express uses the callback arity at runtime to distinguish this from an
 * ordinary route. `error` stays unknown until the application identifies the
 * specific middleware failure, and `next` preserves errors it does not own.
 */
typedef ExpressErrorHandler = (error: Unknown, req: ExpressRequest,
  res: ExpressResponse, next: Unknown->Void) -> Void;

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
  @:native("use") function useError(handler: ExpressErrorHandler): Void;
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
 * - `body` stays `Unknown` until the route's decoder has checked its runtime
 *   shape. This prevents an Express `any` default from leaking into ordinary
 *   Haxe application code or generated TypeScript.
 */
@:ts.type("import('express').Request<Record<string, string>, unknown, unknown>")
typedef ExpressRequest = {
  var params: DynamicAccess<String>;
  var body: Unknown;
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
