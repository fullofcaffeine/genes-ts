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

// Use React's own typing contract for dependency lists (TS-first).
@:ts.type("import('react').DependencyList")
typedef ReactDeps = Array<Dynamic>;

typedef ChangeEvent = {
  final target: {
    final value: String;
  };
}

// Map `State<T>` to the real React tuple type in generated TS:
//   [T, Dispatch<SetStateAction<T>>]
//
// `$0` expands to the first concrete type argument at the use site.
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
