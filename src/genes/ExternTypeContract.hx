package genes;

import genes.Dependencies.DependencyType;
import genes.util.TypeUtil;
import haxe.macro.Type;

/**
 * Classifies explicit TypeScript type projections for JavaScript extern values.
 *
 * Why: some imported constructors cannot safely use their local identifier as
 * a TypeScript instance type. A CommonJS `export =` package may expose only a
 * constructor value, and older externs may give a package export a native name
 * such as `String` or `RegExp` that Haxe later treats as a host built-in.
 * In both cases, constructor calls are valid but a direct type name can mean a
 * different value or fail TypeScript checking.
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
   * Finds a package extern whose native name collides with a built-in type.
   *
   * Why: Haxe's JavaScript preparation gives `String` and `RegExp` special
   * meaning. That is correct for host globals, but it can erase the public type
   * identity of an extern whose constructor actually comes from a package.
   *
   * What: the returned name means an emitted TypeScript type needs an explicit
   * imported-instance contract. Host-only `@:native` declarations and normal
   * package names return `null`.
   *
   * How: require both the reviewed built-in name and an external
   * `@:jsRequire` dependency. This remains a small semantic classification;
   * dependency planning and the type printer still own reachability and syntax.
   */
  public static function packageBuiltInNativeName(type: BaseType): Null<String> {
    final nativeName = TypeUtil.nativeName(type.meta);
    if (nativeName != 'String' && nativeName != 'RegExp')
      return null;
    final dependency = Dependencies.makeDependency(type);
    return dependency != null && dependency.external ? nativeName : null;
  }

  /**
   * Stops an ambiguous built-in-name package type before output is published.
   *
   * The runtime import is still valid without `@:ts.instanceType`, so this
   * check runs only when the declaration is used in emitted TypeScript syntax.
   * The diagnostic gives the extern author one typed correction instead of
   * letting a package instance silently become primitive `string` or the host
   * `RegExp` shape.
   */
  public static function validateBuiltInNativeType(type: BaseType): Void {
    if (usesImportedInstanceType(type))
      return;
    final nativeName = packageBuiltInNativeName(type);
    if (nativeName == null)
      return;
    CompilerDiagnostic.fail(
      'GENES-EXTERN-BUILTIN-NAME-TYPE-001: package extern '
      + type.module + ' uses @:native("' + nativeName + '") in an emitted '
      + 'TypeScript type. Haxe reserves that name for its JavaScript built-in, '
      + 'so Genes cannot infer the package instance type safely. Add '
      + '@:ts.instanceType to this non-generic constructor extern.',
      type.pos);
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
