package package_shapes.field_named;

/**
 * Calls the named `fieldValue` export from the same JavaScript module.
 *
 * Its Haxe field name intentionally matches the default-import fixture. The
 * full typed owner, not this repeated word or a source location, must decide
 * which collision-safe generated local is used.
 */
@:jsRequire("genes-binding-identity-fixture/fields", "fieldValue")
extern function fieldValue(): String;
