package mapdynamic;

/** Proves ordinary typed Map iteration keeps its inline output path. */
class TypedOnly {
  public static function main(): Void {
    final map = new Map<String, Int>();
    map.set("first", 1);
    final entry = map.keyValueIterator().next();
    NodeConsole.log('typed:${entry.key}=${entry.value}');
  }
}
