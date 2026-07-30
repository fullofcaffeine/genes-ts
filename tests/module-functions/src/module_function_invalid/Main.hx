package module_function_invalid;

function occupiedBinding(): Int {
  return 1;
}

@:keep
class CollisionOwner {}

#if module_function_generic_owner
@:keep
class Invalid<T> {
  @:genes.moduleFunction("genericOwnerFunction")
  public static function selected(value: Int): Int {
    return value;
  }
}
#else
@:keep
class Invalid {
  #if module_function_instance
  public function new() {}
  #end

  #if module_function_arity
  @:genes.moduleFunction
  #elseif module_function_arity_multiple
  @:genes.moduleFunction("first", "second")
  #elseif module_function_nonliteral
  @:genes.moduleFunction(BINDING)
  #elseif module_function_empty
  @:genes.moduleFunction("")
  #elseif module_function_identifier
  @:genes.moduleFunction("await")
  #elseif module_function_object_global
  @:genes.moduleFunction("Object")
  #elseif module_function_undefined_global
  @:genes.moduleFunction("undefined")
  #elseif module_function_collision
  @:genes.moduleFunction("CollisionOwner")
  #elseif module_function_duplicate
  @:genes.moduleFunction("duplicateBinding")
  #elseif module_function_instance
  @:genes.moduleFunction("instanceFunction")
  #elseif module_function_inline
  @:genes.moduleFunction("inlineFunction")
  #elseif module_function_dynamic
  @:genes.moduleFunction("dynamicFunction")
  #elseif module_function_overload
  @:genes.moduleFunction("overloadedFunction")
  @:overload(function(value: String): String {})
  #elseif module_function_raw_syntax
  @:genes.moduleFunction("rawSyntaxFunction")
  #elseif module_function_non_async_await_syntax
  @:genes.moduleFunction("nonAsyncAwaitSyntax")
  #elseif module_function_property
  @:genes.moduleFunction("propertyFunction")
  #elseif module_function_prototype
  @:native("prototype")
  @:genes.moduleFunction("prototypeFunction")
  #elseif module_function_duplicate_native
  @:native("sharedProperty")
  @:genes.moduleFunction("duplicateNativeFunction")
  #elseif module_function_module_field_collision
  @:genes.moduleFunction("occupiedBinding")
  #elseif module_function_global_collision
  @:genes.moduleFunction("\u0024global")
  #elseif module_function_private_helper_collision
  @:genes.moduleFunction("__Invalid_privateHelper")
  #end
  #if module_function_property
  public static var selected: Int = 1;
  #elseif module_function_instance
  public function selected(value: Int): Int {
  #elseif module_function_inline
  public static inline function selected(value: Int): Int {
  #elseif module_function_dynamic
  public static dynamic function selected(value: Int): Int {
  #else
  #if module_function_expose_mismatch
  @:expose("publicSelected")
  @:genes.moduleFunction("privateSelected")
  #elseif module_function_expose_arity
  @:expose("first", "second")
  @:genes.moduleFunction("selected")
  #elseif module_function_expose_nonliteral
  @:expose(BINDING)
  @:genes.moduleFunction("selected")
  #elseif module_function_expose_empty
  @:expose("")
  @:genes.moduleFunction("selected")
  #elseif module_function_expose_identifier
  @:expose("await")
  @:genes.moduleFunction("selected")
  #end
  public static function selected(value: Int): Int {
  #end
#if !module_function_property
#if module_function_raw_syntax
return js.Syntax.code("{0} + 1", value);
#elseif module_function_non_async_await_syntax
return js.Syntax.code("await {0}", value);
#elseif module_function_private_helper_collision
return privateHelper(value);
#else
return value;
#end
}
#end

#if module_function_duplicate
@:genes.moduleFunction("duplicateBinding")
public static function second(value: Int): Int {
  return value + 1;
}
#end

#if module_function_duplicate_native
@:native("sharedProperty")
public static function second(value: Int): Int {
  return value + 1;
}
#end

#if module_function_private_helper_collision
@:genesLowerPrivateHelper
static function privateHelper(value: Int): Int {
  return value + 1;
}
#end
}
#end

class Main {
  static function main(): Void {
    #if (module_value_arity
      || module_value_arity_multiple
      || module_value_nonliteral
      || module_value_empty
      || module_value_identifier
      || module_value_public_name
      || module_value_native_name
      || module_value_mutable
      || module_value_function
      || module_value_mixed
      || module_value_dual_marker
      || module_value_function_collision
      || module_value_forward_read
      || module_value_iife_forward_read
      || module_value_local_closure_forward_read
      || module_value_reassigned_closure_forward_read
      || module_value_called_closure_mutation_forward_read
      || module_value_zero_iteration_closure_forward_read
      || module_value_switch_closure_forward_read
      || module_value_try_closure_forward_read
      || module_value_function_forward_read
      || module_value_class_static_forward_read
      || module_value_callback_argument_forward_read
      || module_value_instance_method_forward_read
      || module_value_constructor_forward_read)
    #if (module_value_forward_read
      || module_value_iife_forward_read
      || module_value_local_closure_forward_read
      || module_value_reassigned_closure_forward_read
      || module_value_called_closure_mutation_forward_read
      || module_value_zero_iteration_closure_forward_read
      || module_value_switch_closure_forward_read
      || module_value_try_closure_forward_read
      || module_value_function_forward_read
      || module_value_class_static_forward_read
      || module_value_callback_argument_forward_read
      || module_value_instance_method_forward_read
      || module_value_constructor_forward_read)
    trace(module_function_invalid.ModuleValueInvalid.first);
    #else
    trace(module_function_invalid.ModuleValueInvalid.value);
    #end
    #if module_value_function_collision
    trace(module_function_invalid.ModuleValueInvalid.ModuleValueFunctionCollision.selected());
    #end
    #elseif module_value_cycle
    trace(module_function_invalid.ModuleValueCycleA.cycleA);
    #elseif module_value_class_static
    trace(module_function_invalid.ModuleValueInvalid.value);
    #else
    occupiedBinding();
    #if module_function_generic_owner
    Invalid.selected(1);
    #elseif module_function_instance
    new Invalid().selected(1);
    #elseif module_function_property
    Invalid.selected;
    #else
    Invalid.selected(1);
    #end
    #end
  }
}
