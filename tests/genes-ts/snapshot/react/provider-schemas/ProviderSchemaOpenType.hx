#if macro
import haxe.macro.Context;
import haxe.macro.Type;

/**
 * Supplies the open structure that `ProviderSchemaElements` extends.
 *
 * `build` returns `{values: Array<?>}`. The element type is an unresolved
 * inference variable, which ordinary Haxe source cannot put in a typedef.
 * Each call returns a new variable, so two typedefs do not share one.
 */
class ProviderSchemaOpenType {
  public static function build(): Type {
    return Context.typeof(macro {values: []});
  }
}
#end
