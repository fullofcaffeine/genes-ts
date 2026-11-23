package inc;

import inc.AliasShape as AliasedShape;

/**
 * Names `inc.AliasShape` only through an import alias (genes-44h0).
 *
 * Haxe 4.3.7 turns `import ... as AliasedShape` into a private typedef of
 * this module that is not in the module's declaration list. Genes prints it
 * as `export type AliasedShape = AliasShape`, and `inc.AliasUser` reaches it
 * through the type of `shape`.
 */
class AliasModel {
  public final shape: AliasedShape;

  public function new() {
    shape = {id: 1};
  }
}
