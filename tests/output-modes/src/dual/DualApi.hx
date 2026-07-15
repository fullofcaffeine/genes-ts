package dual;

import genes.ts.Undefinable;

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
}
