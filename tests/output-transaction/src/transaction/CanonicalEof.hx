package transaction;

/**
 * Keeps ordinary module-level functions in a separate generated source file.
 *
 * Why: a module that ends in synthetic Haxe field registration exposed extra
 * blank lines at the end of generated source. The transaction fixture needs
 * that exact generic shape without depending on a frontend framework.
 */
function canonicalEof(value: String): String {
  return decorate(value);
}

private function decorate(value: String): String {
  return '<$value>';
}
