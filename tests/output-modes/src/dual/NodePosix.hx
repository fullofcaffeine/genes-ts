package dual;

/**
 * Typed boundary to Node's `path.posix` value.
 *
 * Why: the dual-output corpus needs a real ecosystem value import whose
 * runtime identity is exercised by current Genes, vanilla Genes, and standard
 * Haxe JS. A built-in Node module keeps the fixture hermetic.
 *
 * What/How: `@:jsRequire` binds the extern class to the named `posix` export.
 * Genes profiles emit an ESM named import; standard Haxe JS emits the
 * equivalent CommonJS require in its `.cjs` oracle. The two-argument signature
 * is intentionally the smallest typed slice used by this fixture.
 */
@:jsRequire("node:path", "posix")
extern class NodePosix {
  public static function join(left:String, right:String):String;
}
