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
import package_shapes.native_named.NativeNamedExport;
import package_shapes.native_regexp.NativeRegExp;
import package_shapes.native_string.NativeString;
import package_shapes.native_dotted.NativeComponent;
import package_shapes.native_only.HostDate;
import package_shapes.abstract_binding.ImportedCode;
import package_shapes.abstract_namespace.NamespaceCode;
import package_shapes.field_default.DefaultField.fieldValue as defaultImportedFieldValue;
import package_shapes.field_named.NamedField.fieldValue as namedImportedFieldValue;

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
  final localNativeNamedBinding: String;
  final localNativeRootBinding: String;
  final nativeNamedBinding: String;
  final nativeRegExpBinding: String;
  final nativeStringBinding: String;
  final nativeDottedBinding: String;
  final nativeOnlyYear: Int;
  final abstractBinding: String;
  final abstractNamespaceBinding: String;
  final defaultFieldBinding: String;
  final namedFieldBinding: String;
  final nodeProcessBinding: String;
}

/**
 * An ordinary Haxe class that happens to use the old imported root's name.
 *
 * Keeping this class in the generated module turns the dotted-native case into
 * an observable collision: raw `NativeRoot.Component` would select this local
 * class, while the correct package root receives a safe generated alias.
 */
private class NativeRoot {
  public static function marker(): String {
    return "local-root";
  }
}

/** The unrelated local that forces the named package import to be renamed. */
private class NativeNamed {
  public static function marker(): String {
    return "local-named";
  }
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
 * aliases, a namespace import, a dotted `Dropdown.Menu` member, and older
 * `@:native` declarations whose package imports must remain authoritative.
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

  /** Keeps the unrelated local root visible in generated runtime output. */
  public static function localNativeRootValue(): String {
    return NativeRoot.marker();
  }

  /** Keeps the unrelated non-dotted local visible in generated output. */
  public static function localNativeNamedValue(): String {
    return NativeNamed.marker();
  }

  /** Uses the package export, never the same-looking local Haxe class. */
  public static function nativeNamedValue(): NativeNamedExport {
    return new NativeNamedExport();
  }

  /**
   * Exposes a package class whose runtime name overlaps the built-in RegExp.
   */
  public static function nativeRegExpValue(): NativeRegExp {
    return new NativeRegExp();
  }

  public static function nativeRegExpMarker(): String {
    return nativeRegExpValue().marker();
  }

  /**
   * Exposes the package class whose JavaScript name is also `String`.
   *
   * This return type is the important part of the experiment. Runtime calls
   * already reach the package correctly; a generated public type must describe
   * that same package value instead of silently becoming Haxe's built-in string.
   */
  public static function nativeStringValue(): NativeString {
    return new NativeString();
  }

  public static function nativeStringMarker(): String {
    return nativeStringValue().marker();
  }

  /** Selects `.Component` only after resolving the imported root's alias. */
  public static function nativeDottedValue(): NativeComponent {
    return new NativeComponent();
  }

  /** Proves that `@:native` without a package still uses the host global. */
  public static function nativeOnlyValue(): HostDate {
    return new HostDate(0);
  }

  /** Reads a package constant through a non-core extern enum abstract. */
  public static function abstractValue(): ImportedCode {
    return ImportedCode.Alpha;
  }

  /** Reads a package constant through a whole-module extern enum abstract. */
  public static function abstractNamespaceValue(): NamespaceCode {
    return NamespaceCode.NamespaceAlpha;
  }

  /** Calls two same-named Haxe fields that select different ESM bindings. */
  public static function defaultFieldValue(): String {
    return defaultImportedFieldValue();
  }

  public static function namedFieldValue(): String {
    return namedImportedFieldValue();
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
      dropdownMenuBinding: dropdownMenuValue().marker(),
      localNativeNamedBinding: localNativeNamedValue(),
      localNativeRootBinding: localNativeRootValue(),
      nativeNamedBinding: nativeNamedValue().marker(),
      nativeRegExpBinding: nativeRegExpMarker(),
      nativeStringBinding: nativeStringMarker(),
      nativeDottedBinding: nativeDottedValue().marker(),
      nativeOnlyYear: nativeOnlyValue().getUTCFullYear(),
      abstractBinding: abstractValue(),
      abstractNamespaceBinding: abstractNamespaceValue(),
      defaultFieldBinding: defaultFieldValue(),
      namedFieldBinding: namedFieldValue(),
      nodeProcessBinding: js.Node.process.version.charAt(0)
    };
  }

  public static function main(): Void {
    js.Node.console.log(haxe.Json.stringify(transcript()));
  }
}
