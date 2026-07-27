package react_hooks;

import genes.react.React.useState;

/**
 * Haxe `-main` entry that roots one selected placement-negative module function.
 *
 * The class exists only for the compiler entry contract; each React body below
 * remains a module function, matching normal Haxe and JavaScript authoring.
 */
class HookPlacementNegative {
  static function main(): Void {
    #if react_hook_outside
    final retained = ordinary;
    #elseif react_hook_loop
    final retained = useLoop;
    #elseif react_hook_nested
    final retained = useNested;
    #elseif react_hook_protected
    final retained = useProtected;
    #elseif react_hook_after_return
    final retained = useAfterReturn;
    #else
    final retained = useConditional;
    #end
    if (retained == null) throw "negative fixture was not retained";
  }
}

#if react_hook_outside
function ordinary(): Int {
  return useState(0).value;
}
#elseif react_hook_loop
@:genes.reactHook
function useLoop(values: Array<Int>): Int {
  for (value in values) {
    return useState(value).value;
  }
  return 0;
}
#elseif react_hook_nested
@:genes.reactHook
function useNested(): Void->Int {
  return () -> useState(0).value;
}
#elseif react_hook_protected
@:genes.reactHook
function useProtected(): Int {
  try {
    return useState(0).value;
  } catch (error: haxe.Exception) {
    return 0;
  }
}
#elseif react_hook_after_return
@:genes.reactHook
function useAfterReturn(enabled: Bool): Int {
  if (!enabled) {
    return 0;
  }
  return useState(0).value;
}
#else
@:genes.reactHook
function useConditional(enabled: Bool): Int {
  if (enabled) {
    return useState(0).value;
  }
  return 0;
}
#end
