export default class DefaultFoo {
  marker() {
    return "default";
  }
}

export class Foo {
  marker() {
    return "named";
  }
}

export function namespaceMarker() {
  return "namespace";
}

export class Dropdown {
  static rootMarker() {
    return "dropdown-root";
  }

  static Menu = class DropdownMenu {
    marker() {
      return "dropdown-menu";
    }
  };
}
