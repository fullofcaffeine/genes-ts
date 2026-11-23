package inc;

/**
 * Reads fields whose types are import aliases, so its walk takes steps to
 * them (genes-44h0): `AliasModel.shape` (alias `AliasedShape`) and
 * `AliasHxModel.shape` (alias `HxShape` from `import.hx`). The shadow gate
 * edits the marked lines.
 */
class AliasUser {
  public static function run(): String {
    final shape = new AliasModel().shape; /*ALIAS_MODEL_USE*/
    final hxShape = new inc.aliashx.AliasHxModel().shape;
    /*ALIAS_INLINE_USE*/
    return "alias" + shape.id + hxShape.id;
  }
}
