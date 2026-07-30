package module_functions;

/**
 * Proves a genuine module value remains public only from its owning module.
 *
 * `@:expose` is intentionally redundant here: the Haxe module field already
 * emits `export const exposedValue`. It must not create a second compilation-
 * root barrel export or collide with same-named values in other modules.
 */
@:expose
@:genes.moduleValue("exposedValue")
final exposedValue = "owned-module-only";
