package todo.web;

import genes.react.Element;
import haxe.extern.EitherType;

// Small typed wrappers to keep the todoapp harness code free of `Dynamic` and `untyped`.
//
// Note: some JS interop for React hooks is inherently dynamic. Keep that surface
// contained to this module (and avoid leaking `any` into generated TS).

typedef ReactElement = Element;

// In this app we use text nodes and conditional `null` in a few spots.
typedef ReactChild = Null<EitherType<ReactElement, String>>;
typedef ReactComponent = Void->ReactElement;
typedef ReactComponent1<P> = P->ReactElement;

/**
 * React hook dependency list type.
 *
 * Why:
 * - We want the generated TS to be fully compatible with React's canonical types
 *   from `@types/react`, without depending on a dedicated Haxe React library.
 *
 * What:
 * - On the Haxe side we treat it as an array.
 *
 * How:
 * - `@:ts.type` forces the emitted TS alias to be `import('react').DependencyList`.
 * - We accept that the concrete element type is intentionally opaque to keep the
 *   rest of the harness strongly typed.
 */
@:ts.type("import('react').DependencyList")
typedef ReactDeps = Array<Dynamic>;

typedef ChangeEvent = {
  final target: {
    final value: String;
  };
}

/**
 * Strongly typed wrapper over React's `useState` tuple.
 *
 * Why:
 * - Haxe does not have a native “tuple” type that maps 1:1 to React's
 *   `[value, setter]` contract.
 * - We want the todoapp code to avoid `Dynamic`, while still generating idiomatic,
 *   fully typed TS that matches React's real hook types.
 *
 * What:
 * - `State<T>` is an abstract over `Array<Dynamic>` (the runtime representation),
 *   providing typed accessors (`value` and `set(...)`).
 *
 * How:
 * - `@:ts.type("[ $0, Dispatch<SetStateAction<$0>> ]")` forces the emitted TS type
 *   to the real tuple form.
 * - `$0` expands to the concrete type parameter at each use site.
 * - The only dynamic boundary is inside this module, so the rest of the app stays
 *   strictly typed.
 */
@:ts.type("[ $0, import('react').Dispatch<import('react').SetStateAction<$0>> ]")
abstract State<T>(Array<Dynamic>) {
  public var value(get, never): T;

  inline function get_value(): T {
    return cast this[0];
  }

  public inline function set(next: T): Void {
    final setter: T->Void = cast this[1];
    setter(next);
  }
}
