package tests;

import js.lib.Promise as JsPromise;

/**
 * Provides a cross-module function value for async emitter regression tests.
 *
 * Why: Haxe represents module-level functions through a generated module-field
 * container. Genes must preserve that representation through ESM imports even
 * when the call is nested inside a `js.Syntax.code` placeholder such as the
 * primitive used by `genes.js.Async.await`.
 *
 * What/How: keeping this as a module-level function deliberately exercises the
 * accessor shape that a shell class would hide. Both output profiles should
 * call the imported `AsyncAwaitHelper_Fields_` binding and resolve the same
 * promise value at runtime.
 */
function resolveModuleValue(value:Int):JsPromise<Int> {
  return JsPromise.resolve(value);
}
