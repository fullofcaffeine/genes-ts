package dual;

#if dual_import_attributes
/**
 * One explicit local spelling for the checked JSON default export.
 *
 * This and `SecondAliasProfile` prove that two useful local names may share
 * one export when their loader contract is identical.
 */
@:jsRequire("../resources/profile.json", "default")
@:genes.importAttributeType("json")
@:genes.importAlias("FirstProfile")
extern class FirstAliasProfile {
  static final profile:String;
}
#end
