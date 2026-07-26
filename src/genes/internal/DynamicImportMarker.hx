package genes.internal;

/**
 * Carries one extension-free dynamic module request through Haxe typing.
 *
 * Why: Haxe's compilation server may reuse a typed expression after the next
 * request changes from `.mjs` to `.jsx`, `.ts`, or another output profile. A
 * final request string created by the macro would then contain a stale suffix.
 *
 * What: `Genes.dynamicImport()` emits this exact typed call only while the
 * Genes generator capability is active. The shared expression emitter replaces
 * it with native `import()` and appends the current generation's runtime
 * suffix. Standard Haxe output keeps using its existing direct syntax path.
 *
 * How: this extern has no runtime implementation and `@:noCompletion` keeps it
 * out of ordinary editor suggestions. Marker recognition uses the typed module
 * and field identity in `CompilerInternal`; generated source must never contain
 * this class or method name.
 */
@:genes.compilerInternal
@:noCompletion
extern class DynamicImportMarker {
  /**
   * Carries one literal, extension-free module path to the Genes emitter.
   *
   * The promise payload uses the existing `DynamicImportModule` boundary:
   * `Genes.dynamicImport()` immediately narrows the loaded namespace to the
   * exact requested Haxe declarations before user code can access it. The
   * source file/range restores the authored macro-call mapping after Haxe
   * reification; all four values disappear with this marker during emission.
   */
  public static function load(path: String, sourceFile: String,
    sourceMin: Int, sourceMax: Int):
    js.lib.Promise<genes.Genes.DynamicImportModule>;
}
