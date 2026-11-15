package servercase;

/**
 * A kept module that no other module imports.
 *
 * The retyped-module case of `yarn test:compiler-server` names it on the
 * command line and edits its text. Haxe must then type this module only.
 */
@:keep
class UnimportedLeaf {
  public static function label(): String {
    return "leaf-v1";
  }
}
