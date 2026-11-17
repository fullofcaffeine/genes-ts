package refresh;

import genes.react.Element;
import genes.react.JSX.*;

typedef CycleProps = {
  final n: Int;
}

/** Keeps `Cycle_Fields_`: an ordinary module function. */
function cyclePlain(): Int {
  return CycleDep.value() + 1;
}

/**
 * A direct (hoisted) function that reads a component. `CycleDep.__init__`
 * calls it during the import cycle, before a split sibling would have
 * defined `Cycle_Fields_`, so the module stays one file.
 */
@:genes.moduleFunction("cycleRender")
function cycleRender(): Element {
  return CycleBadge({n: 1});
}

@:genes.reactComponent
function CycleBadge(props: CycleProps): Element {
  return <s data-cycle="">{Std.string(props.n)}</s>;
}
