package servercase;

/**
 * A second kept module that no other module imports.
 *
 * The retyped-module case of `yarn test:compiler-server` edits this module
 * and `UnimportedLeaf` in turn. Two modules are needed because Haxe hangs the
 * unwanted dependencies on one module of its own choice. If that module were
 * the only edited one, the defect would stay hidden.
 */
@:keep
class UnimportedNeighbor {
  public static function label(): String {
    return "neighbor-v1";
  }
}
