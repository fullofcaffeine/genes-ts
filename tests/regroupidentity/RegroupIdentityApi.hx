package tests.regroupidentity;

import tests.regroupidentity.result.RegroupResult as Result;
import tests.regroupidentity.status.RegroupStatus as Status;
import tests.regroupidentity.MixedNullableStep.MixedNullable;

/**
 * Public boundary that exposes the two same-spelled generic declarations.
 *
 * Keeping the declarations in separate modules forces Genes to retain their
 * exact dependency identities in both TypeScript source and classic `.d.ts`.
 */
class RegroupIdentityApi {
  public static function status(value:String):Status<String> {
    return new Status(value);
  }

  public static function result(
    input:Int,
    output:String,
    quality:Bool
  ):Result<Int, String, Bool> {
    return new Result(input, output, quality);
  }

  /**
   * Preserves a mixed nullable/plain payload without a generated assertion.
   */
  public static function unchanged<T>(
    value:MixedNullable<T>
  ):MixedNullableStep<T> {
    return Mixed(value);
  }
}
