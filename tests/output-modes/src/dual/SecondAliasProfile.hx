package dual;

#if dual_import_attributes
/**
 * A second local name for the JSON value used by `FirstAliasProfile`.
 *
 * The JavaScript module and JSON loading rule are unchanged, but this Haxe
 * declaration deliberately asks for the local name `SecondProfile`. The test
 * keeps that supported aliasing behavior separate from loader-rule conflicts.
 */
@:jsRequire("../resources/profile.json", "default")
@:genes.importAttributeType("json")
@:genes.importAlias("SecondProfile")
extern class SecondAliasProfile {
  static final profile:String;
}
#end
