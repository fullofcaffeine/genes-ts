import genes.react.Element;
import genes.react.JSX.*;

typedef WorldArchiveProps = {
  final bundleName: String;
}

/**
 * Proves the recommended one-component-per-module React authoring shape.
 *
 * The Haxe module and function intentionally share `WorldArchive`. The single
 * React marker supplies component identity and derives the direct module
 * function; the build profile owns HXX parsing.
 */
@:genes.reactComponent
function WorldArchive(props: WorldArchiveProps): Element {
  return <article data-component="world-archive">{props.bundleName}</article>;
}
