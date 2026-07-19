package todo.extern;

import genes.react.Element;
import genes.react.Node;

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
 * - `@:genes.jsxComponentProps("...")` points HXX at a closed Haxe property
 *   type. The string is resolved at compile time, so missing or wrong Router
 *   properties fail in Haxe before JSX is emitted.
 * - `@:ts.type(...)` pins type aliases to React Router’s own TS types so we
 *   avoid `any` and keep the output idiomatic.
 */
import haxe.DynamicAccess;

@:genes.compilerInternal typedef BrowserRouterProps = {
  final children: Node;
}

@:genes.compilerInternal typedef RoutesProps = {
  final children: Node;
}

@:genes.compilerInternal typedef RouteProps = {
  final path: String;
  final element: Element;
}

@:genes.compilerInternal typedef LinkStyle = {
  @:optional final flex: String;
  @:optional final textDecoration: String;
}

@:genes.compilerInternal typedef LinkProps = {
  final to: String;
  final children: Node;
  @:optional final style: LinkStyle;
}

@:jsRequire("react-router-dom", "BrowserRouter")
@:genes.jsxComponentProps("todo.extern.ReactRouterDom.BrowserRouterProps")
extern class BrowserRouter {}

@:jsRequire("react-router-dom", "Routes")
@:genes.jsxComponentProps("todo.extern.ReactRouterDom.RoutesProps")
extern class Routes {}

@:jsRequire("react-router-dom", "Route")
@:genes.jsxComponentProps("todo.extern.ReactRouterDom.RouteProps")
extern class Route {}

@:jsRequire("react-router-dom", "Link")
@:genes.jsxComponentProps("todo.extern.ReactRouterDom.LinkProps")
extern class Link {}

@:jsRequire("react-router-dom", "useNavigate")
extern function useNavigate(): String->Void;

/**
 * Params returned by `useParams()`.
 *
 * `useParams()` is typed in TS as:
 * `Readonly<Record<string, string | undefined>>`.
 *
 * We represent it as `DynamicAccess<String>` because route parameter names are
 * chosen by each application's URL patterns and cannot be enumerated in this
 * small generic extern. The value type remains `String`, and the weak key
 * boundary is confined to this return type rather than leaking through the
 * component property contracts.
 * In TS output, `@:ts.type` ensures consumers see the correct Router type.
 */
@:ts.type("Readonly<Record<string, string | undefined>>")
typedef Params = DynamicAccess<String>;

@:jsRequire("react-router-dom", "useParams")
extern function useParams(): Params;
