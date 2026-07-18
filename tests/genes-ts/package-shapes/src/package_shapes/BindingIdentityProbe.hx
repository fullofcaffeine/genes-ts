package package_shapes;

import package_shapes.default_binding.Foo as DefaultFoo;
import package_shapes.named_binding.Foo as NamedFoo;

/** The two runtime values that the binding-identity probe must keep separate. */
typedef BindingIdentityTranscript = {
  final defaultBinding: String;
  final namedBinding: String;
}

/**
 * Reduces a JavaScript import-identity bug to two constructor calls.
 *
 * Why: both externs are named `Foo` and come from the same JavaScript package,
 * but one means the package's default export and the other means its named
 * `Foo` export. Their full Haxe paths and `@:jsRequire` forms make them distinct
 * declarations even though their simple names match.
 *
 * What: a correct compiler prints and resolves two bindings. The package gives
 * them different marker strings, so the expected transcript is
 * `{"defaultBinding":"default","namedBinding":"named"}`.
 *
 * How: the manual `probe:binding-identity` command runs this same Haxe source
 * through genes-ts and classic Genes. Until genes-ntz is fixed, both profiles
 * incorrectly resolve the named constructor through the default binding and
 * the command fails with `namedBinding: "default"`.
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

  public static function transcript(): BindingIdentityTranscript {
    final defaultFoo = defaultValue();
    final namedFoo = namedValue();
    return {
      defaultBinding: defaultFoo.marker(),
      namedBinding: namedFoo.marker()
    };
  }

  public static function main(): Void {
    js.Node.console.log(haxe.Json.stringify(transcript()));
  }
}
