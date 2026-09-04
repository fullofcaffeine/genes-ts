package tests.classicdts;

#if macro
import genes.Module;
import haxe.macro.Context;

/** Proves the same-module false-to-true cache transition used by declarations. */
class JsonCacheInvalidationProbe {
  public static function validate(): Void {
    final context = {
      modules: new Map<String, Module>(),
      concrete: new Array<String>(),
      hasFeature: (_: String) -> false
    };
    final module = new Module(context, "tests.typeonly.JsonCacheInvalidation",
      [Context.getType("tests.typeonly.JsonCacheInvalidation")]);
    if (module.usesJsonTypes)
      Context.fatalError("JSON cache invalidation probe expected an initial false result",
        Context.currentPos());
    if (!module.addTypes([
      Context.getType("tests.typeonly.JsonCacheInvalidation.JsonCacheInvalidationPayload")
    ]))
      Context.fatalError("JSON cache invalidation probe did not add the declaration-only type",
        Context.currentPos());
    if (!module.usesJsonTypes)
      Context.fatalError("JSON cache invalidation probe reused a stale false result",
        Context.currentPos());
  }
}
#end
