package inc;

import inc.AliasShape as InlinePt;

/**
 * The known miss of the import alias search (genes-cil5). Only the inline
 * helper `make` names the alias `InlinePt`. When `inc.AliasUser` calls
 * `make()`, Haxe inlines the call and dead-code elimination removes `make`
 * but keeps the class for `label`. No declaration of this module that
 * survives names `InlinePt` then, while the inferred return type of
 * `inc.AliasUser.made` still does.
 */
class AliasInline {
  public static inline function make(): InlinePt {
    return {id: 3};
  }

  public static function label(): String {
    return "inline";
  }
}
