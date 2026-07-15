package genes;

import genes.Dependencies.DependencyType;
import haxe.macro.Type;

/**
 * Classifies explicit TypeScript type projections for JavaScript extern values.
 *
 * Why: a CommonJS `export =` declaration may expose a constructor as a `const`
 * value whose constructed instance lives in a merged namespace. Haxe correctly
 * models that boundary as one `@:jsRequire` extern class, but a synthetic
 * TypeScript default import then occupies only the value namespace. Printing
 * the imported identifier directly in a field type produces TS2709 ("Cannot use
 * namespace ... as a type") even though `new ImportedValue()` is valid.
 *
 * What: `@:ts.instanceType` opts an extern into the semantic contract that a
 * type occurrence means `InstanceType<typeof ImportedValue>`. The import itself
 * remains an ordinary value import, so constructor calls and classic Genes ESM
 * output retain their existing runtime behavior.
 *
 * How: this classifier validates the annotation before the type printer chooses
 * TypeScript spelling. It deliberately requires a non-wildcard external
 * `@:jsRequire` binding and currently rejects generic extern applications,
 * because `InstanceType<typeof Ctor>` cannot preserve Haxe type arguments
 * without a package-specific constructor contract. The compiler cannot infer
 * this mode from `@:jsRequire` alone: genuine class exports already provide a
 * type namespace and should keep the direct projection.
 */
class ExternTypeContract {
  public static inline final INSTANCE_TYPE_META = ':ts.instanceType';

  /** Returns whether the extern explicitly requests imported-instance typing. */
  public static function usesImportedInstanceType(type: BaseType): Bool {
    return type.meta.has(INSTANCE_TYPE_META);
  }

  /**
   * Validates one `@:ts.instanceType` use before target text is emitted.
   *
   * This is intentionally fail-closed. Accepting the metadata on a local class,
   * namespace import, raw type override, or generic application would generate
   * plausible-looking TypeScript with a different or uncheckable contract.
   */
  public static function validateImportedInstanceType(type: BaseType,
      params: Array<Type>): Void {
    switch type.meta.extract(INSTANCE_TYPE_META) {
      case [{params: []}]:
      default:
        CompilerDiagnostic.fail('@:ts.instanceType does not take arguments',
          type.pos);
    }

    if (!type.isExtern) {
      CompilerDiagnostic.fail('@:ts.instanceType is only valid on extern types',
        type.pos);
      return;
    }
    if (type.meta.has(':ts.type') || type.meta.has(':genes.type')) {
      CompilerDiagnostic.fail(
        '@:ts.instanceType cannot be combined with a raw type override', type.pos);
      return;
    }
    if (params.length > 0) {
      CompilerDiagnostic.fail(
        '@:ts.instanceType does not yet support generic extern types', type.pos);
      return;
    }

    final dependency = Dependencies.makeDependency(type);
    if (dependency == null || !dependency.external) {
      CompilerDiagnostic.fail(
        '@:ts.instanceType requires an external @:jsRequire binding', type.pos);
      return;
    }
    if (dependency.type == DAsterisk) {
      CompilerDiagnostic.fail('@:ts.instanceType requires a default or named '
        + 'constructor import, not a namespace import', type.pos);
    }
  }
}
