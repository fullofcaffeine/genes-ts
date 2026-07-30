package module_functions;

/**
 * Supplies a direct ESM name that another Haxe module also uses for one of its
 * own ordinary module-level fields.
 */
@:genes.moduleFunction("collisionName")
function collisionName(): String {
  return "source";
}
