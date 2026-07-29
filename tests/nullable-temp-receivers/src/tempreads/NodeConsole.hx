package tempreads;

/**
 * Why: the fixture needs one stable console call shared by ESM TypeScript and
 * classic JavaScript runtime checks.
 *
 * What: `@:jsRequire("node:console")` binds this extern to Node's built-in
 * console module instead of inventing a Haxe runtime class.
 *
 * How: Genes emits the corresponding module import; the extern contains only
 * the one `log` capability used here, so the host interop boundary stays local
 * to this test.
 */
@:jsRequire("node:console")
extern class NodeConsole {
  static function log(value: String): Void;
}
