package module_functions;

/**
 * Holds observable evidence from the module-level `__init__` body below.
 *
 * This ordinary class is separate from Haxe's compiler-created module-fields
 * owner. The fixture can therefore prove that Genes kept the owner's hidden
 * initializer even though its visible function became a direct ESM binding.
 */
class ModuleInitState {
  public static var value = "before-init";
}

/**
 * Reads the state written when this generated ES module was initialized.
 */
@:genes.moduleFunction("moduleInitValue")
function moduleInitValue(): String {
  return ModuleInitState.value;
}

/** Runs once when this generated ES module is initialized. */
function __init__(): Void {
  ModuleInitState.value = "module-init";
}
