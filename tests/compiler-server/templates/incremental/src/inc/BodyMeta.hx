package inc;

/**
 * Metadata holders that only a typed body declares or names (genes-f8vc.9.27,
 * limit S3 of the review of genes-ts #246).
 *
 * `inc.BodyMetaMacro` writes `@:ts.type("string")` on these holders from an
 * after-typing callback. Haxe does not type this module again, and no
 * declaration of it lists the holders, so no fingerprint and no metadata
 * comparison of `GenerationChangeSet` sees the change:
 *
 * - a field of the structure in the constraint of the type parameter `L` of
 *   the local function `inner`;
 * - the type parameter `P` of the local function `tagged` itself;
 * - a field of the structure in the declared type of the local `box`;
 * - a field of the structure in the type of the argument `arg` of the local
 *   function `wrap`.
 */
class BodyMeta {
  public static function value(): String {
    function inner<L: {lv: Int}>(x: L): Int {
      return x.lv;
    }
    function tagged<P>(item: P): P {
      return item;
    }
    var box: Null<{bv: Int}> = null;
    box = {bv: 2};
    function wrap(arg: {av: Int}): Int {
      return arg.av;
    }
    return Std.string(inner({lv: 1}) + tagged(3) + box.bv + wrap({av: 4}));
  }
}
