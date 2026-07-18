package package_shapes;

import package_shapes.default_binding.Foo as DefaultFoo;
import package_shapes.named_binding.Foo as NamedFoo;
import package_shapes.named_duplicate.Foo as DuplicateNamedFoo;
import package_shapes.alias_first.Foo as FirstAliasFoo;
import package_shapes.alias_second.Foo as SecondAliasFoo;
import package_shapes.namespace_binding.Foo as NamespaceFoo;
import package_shapes.collision_default.Foo as CollisionDefaultFoo;
import package_shapes.dropdown_root.Dropdown as DropdownRoot;
import package_shapes.dropdown_menu.Menu as DropdownMenu;

/** The two runtime values that the binding-identity probe must keep separate. */
typedef BindingIdentityTranscript = {
  final defaultBinding: String;
  final namedBinding: String;
  final duplicateNamedBinding: String;
  final firstAliasBinding: String;
  final secondAliasBinding: String;
  final namespaceBinding: String;
  final collisionDefaultBinding: String;
  final dropdownRootBinding: String;
  final dropdownMenuBinding: String;
}

/**
 * Reduces a JavaScript import-identity bug to a small runtime transcript.
 *
 * Why: both externs are named `Foo` and come from the same JavaScript package,
 * but one means the package's default export and the other means its named
 * `Foo` export. Their full Haxe paths and `@:jsRequire` forms make them distinct
 * declarations even though their simple names match.
 *
 * What: the fixture package gives each relevant JavaScript value a small marker
 * string. The transcript therefore shows which value each Haxe declaration
 * actually reached. It also covers a repeated named declaration, two explicit
 * aliases, a namespace import, and a dotted `Dropdown.Menu` member whose root
 * has to be renamed after a collision.
 *
 * How: `test:binding-identity` runs this same Haxe source through genes-ts and
 * classic Genes, checks both declaration surfaces with the pinned TypeScript
 * versions, and executes both results. The named constructor must never be
 * redirected through the same-looking default binding.
 */
class BindingIdentityProbe {
  /** Returns the package's default export through its exact Haxe declaration. */
  public static function defaultValue(): DefaultFoo {
    return new DefaultFoo();
  }

  /** Returns the named export through its separate exact Haxe declaration. */
  public static function namedValue(): NamedFoo {
    return new NamedFoo();
  }

  /** Proves that a second declaration can share the exact named export/local. */
  public static function duplicateNamedValue(): DuplicateNamedFoo {
    return new DuplicateNamedFoo();
  }

  /** Proves that one export can intentionally retain two requested locals. */
  public static function firstAliasValue(): FirstAliasFoo {
    return new FirstAliasFoo();
  }

  public static function secondAliasValue(): SecondAliasFoo {
    return new SecondAliasFoo();
  }

  /** Proves that a namespace called Foo remains separate from both Foo values. */
  public static function namespaceValue(): String {
    return NamespaceFoo.namespaceMarker();
  }

  /** Reserves `Dropdown` with a default import before the named root appears. */
  public static function collisionDefaultValue(): CollisionDefaultFoo {
    return new CollisionDefaultFoo();
  }

  public static function dropdownRootValue(): String {
    return DropdownRoot.rootMarker();
  }

  /** Proves that `.Menu` is appended after resolving the aliased root. */
  public static function dropdownMenuValue(): DropdownMenu {
    return new DropdownMenu();
  }

  public static function transcript(): BindingIdentityTranscript {
    final defaultFoo = defaultValue();
    final namedFoo = namedValue();
    return {
      defaultBinding: defaultFoo.marker(),
      namedBinding: namedFoo.marker(),
      duplicateNamedBinding: duplicateNamedValue().marker(),
      firstAliasBinding: firstAliasValue().marker(),
      secondAliasBinding: secondAliasValue().marker(),
      namespaceBinding: namespaceValue(),
      collisionDefaultBinding: collisionDefaultValue().marker(),
      dropdownRootBinding: dropdownRootValue(),
      dropdownMenuBinding: dropdownMenuValue().marker()
    };
  }

  public static function main(): Void {
    js.Node.console.log(haxe.Json.stringify(transcript()));
  }
}
