package package_shapes;

/**
 * Typed instance contract exposed by the local CommonJS `export =` fixture.
 *
 * Why: `@:jsRequire` gives Haxe one convenient class-shaped value for both
 * construction and instances, while the package declaration intentionally
 * models its constructor as a `const` plus merged namespace. TypeScript cannot
 * use that imported value identifier directly as an instance type.
 *
 * What: `@:ts.instanceType` asks Genes declarations and TS implementation
 * annotations to emit `InstanceType<typeof ExportEqualsConstructor>`.
 *
 * How: constructor expressions still use the ordinary default import. Classic
 * Genes erases the type projection and executes the same ESM-to-CommonJS
 * default import, while its optional `.d.ts` preserves the precise projection.
 */
@:jsRequire("genes-export-equals-fixture")
@:ts.instanceType
extern class ExportEqualsConstructor {
  public static final version: String;
  public final label: String;

  public function new(label: String);
  public function close(): String;
}
