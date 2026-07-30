package module_functions;

/**
 * Holds observable evidence from the module-level `__init__` body below.
 *
 * This ordinary class is intentionally separate from Haxe's compiler-created
 * module-fields owner. The fixture can therefore prove that Genes kept the
 * owner's hidden initializer even though its visible function becomes direct
 * ESM.
 */
class ModuleInitState {
  public static var value = "before-init";
}

/**
 * Reads state written by this module's `__init__` body.
 *
 * The direct function may leave Haxe's compiler-created owner only when that
 * owner has no remaining work. Here `ClassType.init` still owns a side effect,
 * so Genes must retain the owner long enough to emit the initializer.
 */
@:genes.moduleFunction("moduleInitValue")
function moduleInitValue(): String {
  return ModuleInitState.value;
}

/** Runs once when this generated ES module is initialized. */
function __init__(): Void {
  ModuleInitState.value = "module-init";
}
