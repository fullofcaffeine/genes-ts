package tests.typeonly;

import genes.ts.JsonValue;

/** Forces JSON-support cache use before declaration-only expansion. */
class JsonCacheInvalidation {
  @:genes.moduleFunction("jsonCacheInvalidationTouch")
  public static function touch(): String {
    return "json-cache-invalidation";
  }
}

/** Arrives only when classic declaration reachability expands this module. */
typedef JsonCacheInvalidationPayload = {
  final value: JsonValue;
}
