package todo.web;

// Small typed wrappers to keep the todoapp harness code free of `Dynamic` and `untyped`.
//
// Note: React elements are still fundamentally dynamic values in this minimal setup,
// but we keep the "unsafe" surface contained to this module.

typedef ReactElement = Dynamic;
typedef ReactChild = Dynamic;
typedef ReactComponent = Void->ReactElement;
typedef ReactDeps = Array<Dynamic>;

typedef ChangeEvent = {
  final target: {
    final value: String;
  };
}

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

