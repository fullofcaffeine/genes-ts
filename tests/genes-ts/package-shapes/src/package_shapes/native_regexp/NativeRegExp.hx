package package_shapes.native_regexp;

/**
 * A package class whose JavaScript export is also named `RegExp`.
 *
 * Why: Haxe normally treats that native name as the host's built-in regular
 * expression type. This fixture instead receives a constructor from a package,
 * so its public type must follow the import rather than the host global.
 *
 * What/How: `@:ts.instanceType` states that public TypeScript positions mean
 * an instance created by the imported constructor. Genes keeps that typed
 * import for TS source and classic declarations even if Haxe later rewrites
 * the native name while preparing JavaScript output.
 */
@:native("RegExp")
@:jsRequire("genes-binding-identity-fixture", "RegExp")
@:ts.instanceType
extern class NativeRegExp {
  public function new();
  public function marker(): String;
}
