package module_function_invalid;

/** Negative control for direct values in a cyclic ESM initializer graph. */
@:genes.moduleValue("cycleA")
final cycleA = ModuleValueCycleB.cycleB + 1;
