package dual;

#if dual_import_attributes
/**
 * Models the checked-in JSON module used by the paired TS/classic fixture.
 *
 * Why: JSON ESM needs a runtime import attribute on current Node releases.
 * A dependency that retains only its module specifier compiles successfully but
 * fails before application code runs.
 *
 * What: `@:jsRequire` supplies the default module binding and
 * `@:genes.importAttributeType` records the target-neutral JSON attribute.
 *
 * How: both Genes printers consume that dependency fact and must emit
 * `with { type: "json" }`; the ordinary Haxe JS and vanilla oracle profiles do
 * not enable this fixture-only extern because they do not own that contract.
 */
@:jsRequire("../resources/profile.json", "default")
@:genes.importAttributeType("json")
extern class DualProfileResource {
  static final profile:String;
}
#end
