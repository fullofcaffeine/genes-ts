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
  #elseif module_function_property
  @:genes.moduleFunction("propertyFunction")
  #elseif module_function_prototype
  @:native("prototype")
  @:genes.moduleFunction("prototypeFunction")
  #elseif module_function_duplicate_native
  @:native("sharedProperty")
  @:genes.moduleFunction("duplicateNativeFunction")
  #elseif module_function_import_collision
  @:genes.moduleFunction("ImportedBinding")
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
  public static function selected(value: Int): Int {
  #end
#if !module_function_property
#if module_function_raw_syntax
return js.Syntax.code("{0} + 1", value);
#elseif module_function_import_collision
return ImportedBinding.value();
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
  }
}
