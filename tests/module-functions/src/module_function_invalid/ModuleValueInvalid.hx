package module_function_invalid;

private class ModuleValueHelper {
  public static final number = 1;

  public static function make(): Int {
    return 1;
  }
}

private enum ModuleValueChoice {
  One;
}

#if module_value_class_static
/** Negative control: a class static value keeps its class identity. */
@:keep
class ModuleValueInvalid {
  @:genes.moduleValue("value")
  public static final value = 1;
}
#else
#if (module_value_operator || module_value_control_flow)
@:genes.moduleValue("base")
final base = 1;
#end

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
#elseif module_value_call
final value = ModuleValueHelper.make();
#elseif module_value_constructor
final value = new String("value");
#elseif module_value_operator
final value = base + 1;
#elseif module_value_local
final value = {
  final local = 1;
  local;
};
#elseif module_value_control_flow
final value = if (base == 1) 1 else 2;
#elseif module_value_function_value
final value = () -> 1;
#elseif module_value_property
final value = ModuleValueHelper.number;
#elseif module_value_enum
final value = ModuleValueChoice.One;
#elseif module_value_explicit_cast
final value = cast(1, String);
#elseif module_value_later_reference
final value = later;
#else
final value = 1;
#end

#if module_value_later_reference
@:genes.moduleValue("later")
final later = 2;
#end

#if module_value_mixed
@:keep
function ordinary(): Int {
  return 2;
}
#end
#end
