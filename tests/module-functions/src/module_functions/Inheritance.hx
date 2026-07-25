package module_functions;

/** Base owner for the selected-method inheritance control. */
@:keep
class ModuleFunctionBase {
  @:genes.moduleFunction("baseModuleFunction")
  public static function selected(value: Int): Int {
    return value + 20;
  }
}

/** Proves a subclass initializer observes the base owner's final function. */
@:keep
class ModuleFunctionChild extends ModuleFunctionBase {
  public static var inherited(default,
    null): Int = ModuleFunctionBase.selected(2);
}
