package dual;

import genes.ts.Undefinable;
import genes.ts.JsonValue;

/** Strict consumer surface shared by TS implementation and classic `.d.ts`. */
typedef DualReport = {
  final count:Int;
  final first:Null<String>;
  final missing:Undefinable<String>;
  @:optional final ordinaryOptional:String;
  @:ts.optional final ?label:String;
}

/**
 * Public API used to verify precise target-polymorphic declarations.
 *
 * The methods execute in both runtime profiles. `typeOnly` additionally names
 * a type declaration whose module must exist only in TS/declaration space.
 */
class DualApi {
  public static function summarize(names:Array<String>):DualReport {
    return {
      count: names.length,
      first: names.length == 0 ? null : names[0],
      missing: Undefinable.absent()
    };
  }

  public static function typeOnly():DualTypeOnly {
    return null;
  }

  /**
   * Keeps one recursive JSON boundary visible to external profile consumers.
   *
   * Why: `JsonValue` erases to a native JavaScript value, while TS source and
   * classic `.d.ts` must each define the recursive aliases named by its type
   * projection. The method is intentionally unused by Haxe runtime code so the
   * external-consumer fixture, rather than incidental reachability, owns it.
   *
   * What/How: `@:keep` asks Haxe DCE to retain this ordinary identity method in
   * both executable profiles. The metadata does not alter its generated body;
   * it only makes the public boundary deterministic for declaration QA.
   */
  @:keep
  public static function jsonIdentity(value:JsonValue):JsonValue {
    return value;
  }
}
