package refresh;

import genes.react.Element;
import genes.react.JSX.*;

/**
 * A split module that `Main` loads with `Genes.dynamicImport`. The callback
 * reads `LazyEntry`, which is in `Lazy.fields.tsx`, so the dynamic import
 * loads both files and merges their namespaces.
 */
@:genes.reactComponent
function LazyView(): Element {
  return <em data-lazy="">{lazyLabel()}</em>;
}

/** An ordinary module-level function: `Lazy_Fields_` holds the component slot. */
function lazyLabel(): String {
  return "lazy";
}

@:keep
class LazyEntry {
  public static function render(): Element {
    return <LazyView />;
  }
}
