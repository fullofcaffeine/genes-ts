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
@:expose("module")
@:genes.moduleFunction("module")
function reservedHandlerBinding(): String {
  return "must-not-compile";
}
#end

#if dynamic_import_type_collision
/**
 * Negative control: the exact direct binding collides with a loaded type alias
 * in the generated lazy callback.
 */
@:expose("LazyType")
@:genes.moduleFunction("LazyType")
function lazyTypeBinding(): String {
  return "must-not-compile";
}
#end

/** Runtime module loaded by the focused dynamic-import policy fixture. */
class Target {
  public static function value(): String {
    return "dynamic-import-current";
  }
}
