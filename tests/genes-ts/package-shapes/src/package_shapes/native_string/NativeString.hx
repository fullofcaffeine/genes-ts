package package_shapes.native_string;

/**
 * A package class that deliberately uses JavaScript's built-in name `String`.
 *
 * Why: this is the sharpest non-dotted compatibility case. Haxe and TypeScript
 * normally give `String` special primitive behavior, but this declaration says
 * that the runtime constructor comes from a package instead.
 *
 * What: Genes must import the package's named constructor and give it a safe
 * local name instead of calling the global `String`. Public methods must also
 * describe instances of that package constructor, not primitive text values.
 *
 * How: `@:ts.instanceType` states that a TypeScript type position means
 * `InstanceType<typeof importedConstructor>`. This keeps the runtime and
 * public type tied to the same import even when Haxe later treats the native
 * name as its built-in string during JavaScript preparation.
 */
@:native("String")
@:jsRequire("genes-binding-identity-fixture", "String")
@:ts.instanceType
extern class NativeString {
  public function new();
  public function marker(): String;
}
