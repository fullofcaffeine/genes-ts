package dual;

#if dual_import_attributes
/**
 * First JSON binding that asks to use the local name `SharedProfile`.
 *
 * Why: two Haxe declarations may intentionally describe the same package
 * export. When their loader attribute and requested local also agree, Genes
 * should emit one binding that both declarations can use.
 *
 * What/How: `@:jsRequire` selects the JSON default export, the attribute tells
 * Node to load JSON, and `@:genes.importAlias` supplies the shared local name.
 */
@:jsRequire("../resources/profile.json", "default")
@:genes.importAttributeType("json")
@:genes.importAlias("SharedProfile")
extern class SameAliasProfileOne {
  static final profile:String;
}
#end
