package lexicalbinding;

import genes.Genes;
import lexicalbinding.LazyOne.setStateLazyOne;
import lexicalbinding.LazyTwo.setStateLazyTwo;

/** Nested lazy scopes carry declaration and direct-field bindings separately. */
function nestedDynamicBindings(): Void {
  Genes.dynamicImport(LazyOne -> {
    trace(LazyOne.value());
    trace(setStateLazyOne());
    final nested = Genes.dynamicImport(LazyTwo -> {
      trace(LazyTwo.value());
      trace(setStateLazyTwo());
    });
    trace(nested);
  });
}
