package module_function_invalid;

/** Completes the cycle back to `ModuleValueCycleA`. */
@:genes.moduleValue("cycleB")
final cycleB = ModuleValueCycleA.cycleA + 1;
