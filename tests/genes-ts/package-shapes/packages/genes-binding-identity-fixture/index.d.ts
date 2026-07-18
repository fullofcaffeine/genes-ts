declare class DefaultFoo {
  marker(): "default";
}

declare namespace DefaultFoo {
  class Component {
    constructor();
    marker(): "native-dotted";
  }
}

export default DefaultFoo;

export class Component {
  constructor();
  marker(): "native-dotted";
}

export class NativeNamed {
  constructor();
  marker(): "native-named";
}

export class String {
  constructor();
  marker(): "native-string";
}

export class Foo {
  marker(): "named";
}

export function namespaceMarker(): "namespace";

export class Dropdown {
  static rootMarker(): "dropdown-root";
}

export namespace Dropdown {
  class Menu {
    constructor();
    marker(): "dropdown-menu";
  }
}
