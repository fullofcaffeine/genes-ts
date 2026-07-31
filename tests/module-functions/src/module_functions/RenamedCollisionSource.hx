package module_functions;

/** Foreign direct binding used to prove consumer-local import aliasing. */
@:genes.moduleFunction("renamedBinding")
function renamedBinding(): String {
  return "foreign";
}
