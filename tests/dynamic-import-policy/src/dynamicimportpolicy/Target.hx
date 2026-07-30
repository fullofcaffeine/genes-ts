package dynamicimportpolicy;

/**
 * A genuine module function that must stay inside the lazily loaded namespace.
 */
@:genes.moduleFunction("dynamicSelected")
function dynamicSelected(): String {
  return "dynamic-module-function-current";
}

#if dynamic_import_binding_collision
/** Negative control for the generated lazy-handler namespace parameter. */
@:genes.moduleFunction("module")
function reservedHandlerBinding(): String {
  return "must-not-compile";
}
#end

/** Runtime module loaded by the focused dynamic-import policy fixture. */
class Target {
  public static function value(): String {
    return "dynamic-import-current";
  }
}
