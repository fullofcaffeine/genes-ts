package todo.extern;

/**
 * Minimal React Router externs used by the todoapp example.
 *
 * Why:
 * - The todoapp is a harness for genes-ts and should stay small and readable.
 * - React Router already has first-class TypeScript types; we want the emitted
 *   `.tsx` to be typed using those canonical definitions.
 *
 * What:
 * - A tiny extern surface: the components/hooks used by the example.
 *
 * How:
 * - `@:jsRequire("react-router-dom", "...")` forces the proper imports in
 *   generated TS/TSX output.
 * - `@:ts.type(...)` pins type aliases to React Router’s own TS types so we
 *   avoid `any` and keep the output idiomatic.
 */

import haxe.DynamicAccess;

@:jsRequire("react-router-dom", "BrowserRouter")
extern class BrowserRouter {}

@:jsRequire("react-router-dom", "Routes")
extern class Routes {}

@:jsRequire("react-router-dom", "Route")
extern class Route {}

@:jsRequire("react-router-dom", "Link")
extern class Link {}

@:jsRequire("react-router-dom", "useNavigate")
extern function useNavigate(): String->Void;

/**
 * Params returned by `useParams()`.
 *
 * `useParams()` is typed in TS as:
 * `Readonly<Record<string, string | undefined>>`.
 *
 * We represent it as a dynamic string-keyed map on the Haxe side.
 * In TS output, `@:ts.type` ensures consumers see the correct Router type.
 */
@:ts.type("Readonly<Record<string, string | undefined>>")
typedef Params = DynamicAccess<String>;

@:jsRequire("react-router-dom", "useParams")
extern function useParams(): Params;
