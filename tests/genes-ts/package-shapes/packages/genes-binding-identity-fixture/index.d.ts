export default class DefaultFoo {
  marker(): "default";
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
