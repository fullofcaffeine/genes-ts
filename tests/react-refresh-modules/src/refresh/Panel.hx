package refresh;

import genes.react.Element;
import genes.react.JSX.*;
import genes.react.React.useState;
import genes.react.State;

/** Public props of the public component. */
typedef PanelProps = {
  final title: String;
}

private typedef BadgeProps = {
  final count: Int;
}

/** A public enum beside the components. */
enum Tone {
  Calm;
  Loud(level: Int);
}

/** A public class beside the components; its static initializer is logged. */
class Counter {
  public static final loaded = LoadLog.record("Panel.Counter");

  public static function next(value: Int): Int {
    return value + 1;
  }
}

/** A private class that only this module uses. */
private class Formatter {
  public static function label(count: Int, tone: Tone): String {
    return switch tone {
      case Calm: 'count $count';
      case Loud(level): 'COUNT $count ($level)';
    }
  }
}

/** An ordinary module-level function: Genes keeps it on `Panel_Fields_`. */
function formatCount(count: Int): String {
  return Formatter.label(count, Calm);
}

/**
 * A non-component function that renders a component of the same module.
 * In the split sibling it reads the component through `Panel_Fields_.Badge`.
 */
function badgeFor(count: Int): Element {
  return <Badge count={count} />;
}

/** A Hook beside the components (an exported Hook is not a component). */
@:genes.reactHook
function useCount(initial: Int): State<Int> {
  return useState(initial);
}

/** The public component. Its body uses every other declaration. */
@:genes.reactComponent
function Panel(props: PanelProps): Element {
  final count = useCount(0);
  return <section data-panel="ready">
    <h1 data-title="">{props.title}</h1>
    <Badge count={count.value} />
    <button data-increment="" onClick={() -> count.update(value -> Counter.next(value))}>{formatCount(count.value)}</button>
  </section>;
}

/** A private component in the same module. */
@:genes.reactComponent
private function Badge(props: BadgeProps): Element {
  return <span data-badge="">{Std.string(props.count)}</span>;
}
