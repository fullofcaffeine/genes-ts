/**
 * An intentionally incomplete package extern used by a negative compiler test.
 *
 * Why: `String` and `RegExp` are host built-in type names, but this
 * constructor comes from a package. Without an explicit type contract, Haxe's
 * JavaScript preparation can make the public field below look like the host
 * built-in even though runtime code imports a different value.
 *
 * What/How: the test selects one native name per compilation and deliberately
 * omits `@:ts.instanceType`. Genes must explain the missing contract before
 * replacing either TS or classic output. The positive fixture documents and
 * exercises the supported annotation.
 */
#if genes_fixture_regexp
@:native("RegExp")
@:jsRequire("genes-binding-identity-fixture", "RegExp")
#else
@:native("String")
@:jsRequire("genes-binding-identity-fixture", "String")
#end
extern class BuiltInNativeValue {
  public function new();
}

/** Makes the ambiguous extern part of the generated public type surface. */
class BuiltInNativeMain {
  public static var value: BuiltInNativeValue;

  public static function main(): Void {}
}
