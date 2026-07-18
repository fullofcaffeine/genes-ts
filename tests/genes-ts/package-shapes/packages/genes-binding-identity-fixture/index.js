export class Component {
  marker() {
    return "native-dotted";
  }
}

export class NativeNamed {
  marker() {
    return "native-named";
  }
}

export class String {
  marker() {
    return "native-string";
  }
}

export default class DefaultFoo {
  static Component = Component;

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
