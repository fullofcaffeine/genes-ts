package sideeffectinvalid;

import genes.ts.Imports;

/** Exercises stable compile-time failures for the public side-effect helper. */
class Main {
  #if side_effect_nonliteral
  static function __init__():Void {
    final module = "./runtime/First.js";
    Imports.sideEffect(module);
  }
  #elseif side_effect_empty_attribute
  static function __init__():Void {
    Imports.sideEffectWith("./runtime/config.json", "");
  }
  #elseif side_effect_nested
  static function __init__():Void {
    if (Date.now().getTime() >= 0)
      Imports.sideEffect("./runtime/First.js");
  }
  #elseif side_effect_wrong_method
  static function request():Void {
    Imports.sideEffect("./runtime/First.js");
  }
  #elseif side_effect_target
  static function __init__():Void {
    Imports.sideEffect("./runtime/First.js");
  }
  #end

  public static function main():Void {
    #if side_effect_wrong_method
    request();
    #end
  }
}
