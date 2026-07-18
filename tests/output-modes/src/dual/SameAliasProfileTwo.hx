package dual;

#if dual_import_attributes
/**
 * A second Haxe declaration for the same JSON value as `SameAliasProfileOne`.
 *
 * Both declarations ask for the local name `SharedProfile` and the same JSON
 * loading rule. Genes should therefore generate one JavaScript import and let
 * both Haxe declarations use it.
 */
@:jsRequire("../resources/profile.json", "default")
@:genes.importAttributeType("json")
@:genes.importAlias("SharedProfile")
extern class SameAliasProfileTwo {
  static final profile:String;
}
#end
