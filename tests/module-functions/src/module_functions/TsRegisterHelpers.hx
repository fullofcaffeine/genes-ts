package module_functions;

/**
 * Proves a TypeScript-only assertion retains its compiler runtime dependency.
 *
 * Haxe accepts a nullable numeric relation with JavaScript coercion semantics.
 * Strict TypeScript needs Genes to emit `Register.unsafeCast<number>` around
 * the nullable operand. This direct-only module therefore imports Register in
 * TypeScript profiles even though classic JavaScript needs no helper and no
 * synthetic module-fields owner survives.
 */
@:genes.moduleFunction("positive")
function positive(value: Null<Int>): Bool {
  return value > 0;
}
