package tests.regroupidentity;

import tests.regroupidentity.result.RegroupResult as Result;
import tests.regroupidentity.status.RegroupStatus as Status;
import tests.regroupidentity.BoundaryPlanStep.ConcreteBoundaryStep;
import tests.regroupidentity.BoundaryPlanStep.ConcreteHolder;
import tests.regroupidentity.BoundaryPlanStep.OptionalBoundarySource;
import tests.regroupidentity.BoundaryImportFixture.BoundaryImportFactory;
import tests.regroupidentity.MixedNullableStep.MixedNullable;

/**
 * Public boundary that exposes the two same-spelled generic declarations.
 *
 * Keeping the declarations in separate modules forces Genes to retain their
 * exact dependency identities in both TypeScript source and classic `.d.ts`.
 */
class RegroupIdentityApi {
  public static function status(value: String): Status<String> {
    return new Status(value);
  }

  public static function result(input: Int, output: String,
      quality: Bool): Result<Int, String, Bool> {
    return new Result(input, output, quality);
  }

  /**
   * Preserves a mixed nullable/plain payload without a generated assertion.
   */
  public static function unchanged<T>(value: MixedNullable<T>): MixedNullableStep<T> {
    return Mixed(value);
  }

  /**
   * Crosses one exact concrete nullable enum-payload boundary.
   */
  public static function concreteNullable(value: Null<Int>): ConcreteBoundaryStep {
    return Concrete(value);
  }

  /**
   * Normalizes a missing optional field before asserting the enum payload type.
   */
  public static function concreteOptional(source: OptionalBoundarySource): ConcreteBoundaryStep {
    return Concrete(source.value);
  }

  /**
   * Passes a nullable Haxe value through one ordinary non-null parameter.
   */
  public static function ordinaryNullableArgument(value: Null<Int>): Int {
    return acceptConcrete(value);
  }

  /**
   * Proves that a normal Haxe null guard remains normal TypeScript narrowing.
   */
  public static function guardedNullableArgument(value: Null<Int>): Int {
    if (value == null)
      return 0;
    return acceptConcrete(value);
  }

  /** Initializes a non-null local from a Haxe nullable value. */
  public static function nullableInitializer(value: Null<Int>): Int {
    final concrete: Int = value;
    return concrete;
  }

  /** Assigns a Haxe nullable value to an existing non-null local. */
  public static function nullableAssignment(value: Null<Int>): Int {
    var concrete: Int = 0;
    concrete = value;
    return concrete;
  }

  /** Passes a Haxe nullable value to a non-null constructor parameter. */
  public static function nullableConstructor(value: Null<Int>): ConcreteHolder {
    return new ConcreteHolder(value);
  }

  /**
   * Projects a concrete class to its nullable generic parent at a call.
   *
   * Neither parent nor payload appears in this module's Haxe signatures. The
   * planned assertion is therefore their only TypeScript import owner.
   */
  public static function boundaryOnlyImport(): String {
    return BoundaryImportFactory.accept(BoundaryImportFactory.nullable());
  }

  static function acceptConcrete(value: Int): Int {
    return value;
  }
}
