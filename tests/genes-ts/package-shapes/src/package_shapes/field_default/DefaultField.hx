package package_shapes.field_default;

/**
 * Calls the default export of the fixture's `fields` module.
 *
 * Haxe stores a module-level extern function as a compiler-created static
 * field. Genes must remember this field's owning module so another function
 * named `fieldValue` cannot redirect the call to a different export.
 */
@:jsRequire("genes-binding-identity-fixture/fields")
extern function fieldValue(): String;
