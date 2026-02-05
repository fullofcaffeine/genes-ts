package todo.e2e;

import js.Syntax;
import js.node.Process;
import js.node.console.Console;

/**
 * Typed access to Node.js globals (`process`, `console`) for the Playwright test
 * harness, without triggering hxnodejs deprecation warnings at call sites.
 *
 * Why:
 * - hxnodejs exposes Node globals via `js.Node.process` / `js.Node.console`.
 * - Those are implemented as *inline* getters using `untyped __js__("process")`
 *   / `untyped __js__("console")`.
 * - `__js__` is deprecated, so when the getters inline, each call site emits:
 *   `Warning : (WDeprecated) __js__ is deprecated, use js.Syntax.code instead`.
 *
 * What:
 * - This module provides a tiny, explicit JS interop boundary that:
 *   - returns strongly typed values (no `Dynamic` leaking into tests),
 *   - keeps the warning localized to one place (and avoids it entirely by using
 *     `js.Syntax.code` instead of `__js__`).
 *
 * How:
 * - `js.Syntax.code("process")` / `js.Syntax.code("console")` lower to the
 *   native identifiers in generated TypeScript.
 * - We use a `cast` inside this file only because `js.Syntax.code` returns
 *   `Dynamic` by definition. This is a compile-time type assertion; it does not
 *   change the runtime value.
 */

/**
 * A minimal, typed view of Node's global `process` object.
 *
 * Why `@:ts.type("NodeJS.Process")`:
 * - The Haxe type is `js.node.Process` (hxnodejs), but the best TypeScript type
 *   for generated output is `NodeJS.Process` (from `@types/node`).
 *
 * Why `@:forward(env, cwd)`:
 * - The Playwright harness only needs `env` (for `BASE_URL`) and `cwd()` (for
 *   constructing paths). Forwarding keeps the API ergonomic without exposing
 *   more of `process` than needed.
 */
@:ts.type("NodeJS.Process")
@:forward(env, cwd)
abstract NodeProcess(Process) from Process to Process {}

class NodeGlobals {
  /** Global `process`, typed as `NodeJS.Process` in TS output. */
  public static inline function process(): NodeProcess
    return cast Syntax.code("process");

  /** Global `console` (Node), typed as `console.Console` in TS output. */
  public static inline function console(): Console
    return cast Syntax.code("console");
}

