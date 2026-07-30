package module_function_invalid;

#if module_value_iife_forward_read
/** Negative control: an IIFE reads a later `const` during initialization. */
@:genes.moduleValue("first")
final first = (() -> second)();

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_local_closure_forward_read
/**
 * Negative control: a locally named closure still runs during initialization.
 */
@:genes.moduleValue("first")
final first = {
  final read = () -> second;
  read();
};

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_reassigned_closure_forward_read
/**
 * Negative control: closure ownership follows an exact local reassignment.
 *
 * The first callback is safe, but the replacement reads `second` when `read()`
 * executes during module initialization. Retaining only the declaration-time
 * callback would miss the resulting ESM temporal-dead-zone access.
 */
@:genes.moduleValue("first")
final first = {
  var read = () -> 0;
  read = () -> second;
  read();
};

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_function_forward_read
/**
 * Negative control: a direct function called by an initializer reads a later
 * ESM value immediately, even though a function that is merely stored would
 * defer the read safely.
 */
@:genes.moduleFunction("readSecond")
function readSecond(): Int {
  return second;
}

@:genes.moduleValue("first")
final first = readSecond();

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_forward_read
/** Negative control: ESM cannot read a later `const` during initialization. */
@:genes.moduleValue("first")
final first = second;

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_class_static
/** Negative control: class static identity is not a module-level value. */
@:keep
class ModuleValueInvalid {
  @:genes.moduleValue("value")
  public static final value = 1;
}
#else
#if module_value_arity
@:genes.moduleValue
#elseif module_value_arity_multiple
@:genes.moduleValue("value", "other")
#elseif module_value_nonliteral
@:genes.moduleValue(BINDING)
#elseif module_value_empty
@:genes.moduleValue("")
#elseif module_value_identifier
@:genes.moduleValue("await")
#elseif module_value_public_name
@:genes.moduleValue("renamedValue")
#elseif module_value_native_name
@:native("nativeValue")
@:genes.moduleValue("value")
#elseif module_value_dual_marker
@:genes.moduleFunction("value")
@:genes.moduleValue("value")
#else
@:genes.moduleValue("value")
#end
#if module_value_mutable
var value = 1;
#elseif module_value_function
function value(): Int {
  return 1;
}
#else
final value = 1;
#end

#if module_value_mixed
/** Keeps ordinary synthetic-owner work beside the selected value. */
@:keep
function ordinary(): Int {
  return value + 1;
}
#end

#if module_value_function_collision
/** Proves functions and values compete in one real ESM binding namespace. */
@:keep
class ModuleValueFunctionCollision {
  @:genes.moduleFunction("value")
  public static function selected(): Int {
    return value;
  }
}
#end

#end
