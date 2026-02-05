package todo.server;

import js.Syntax;
import js.node.Process;
import js.node.console.Console;

/**
 * Typed access to Node.js globals (`process`, `console`) without triggering
 * hxnodejs deprecation warnings in user code.
 *
 * Why:
 * - hxnodejs exposes `process`/`console` via `js.Node.process` and `js.Node.console`.
 * - Those are implemented as inline getters calling `untyped __js__("process")`
 *   / `untyped __js__("console")`.
 * - Haxe deprecates `__js__`, so using `js.Node.process/console` triggers:
 *   `Warning : (WDeprecated) __js__ is deprecated, use js.Syntax.code instead`
 *   at *every call site* (because the getter is inlined).
 *
 * What:
 * - This module centralizes the JS interop boundary in one place, so the rest of
 *   the todoapp can use strongly typed APIs without warnings.
 *
 * How:
 * - We use `js.Syntax.code("process")` / `js.Syntax.code("console")`, which
 *   lowers to the native identifiers in the output.
 * - We use a `cast` *inside this module only* to satisfy the Haxe typechecker.
 *   The cast is a compile-time type assertion; it does not “wrap” or change the
 *   runtime value.
 */

/**
 * `process` typed as the real Node `NodeJS.Process` in TS output.
 *
 * Why `@:ts.type`:
 * - Haxe sees this as `js.node.Process`, but the TypeScript type we want in the
 *   emitted `.ts` is `NodeJS.Process` (from `@types/node`).
 *
 * Why `@:forward(env, cwd)`:
 * - We only need `env` and `cwd()` in the todoapp.
 * - Forwarding keeps usage ergonomic while keeping the surface area small.
 */
@:ts.type("NodeJS.Process")
@:forward(env, cwd)
abstract NodeProcess(Process) from Process to Process {}

class NodeGlobals {
  /**
   * Return the global `process` object, typed as `NodeJS.Process` in TS output.
   *
   * This avoids `js.Node.process` (and its inlined `__js__` call sites).
   */
  public static inline function process(): NodeProcess {
    return cast Syntax.code("process");
  }

  /**
   * Return the global `console` object.
   *
   * This avoids `js.Node.console` (and its inlined `__js__` call sites).
   */
  public static inline function console(): Console {
    return cast Syntax.code("console");
  }
}

