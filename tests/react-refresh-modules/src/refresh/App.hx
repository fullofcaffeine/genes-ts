package refresh;

import genes.react.Element;
import genes.react.JSX.*;
import refresh.Panel;
import refresh.Greeting;
import refresh.Unsplit;

/** Imports a component, a module-level function, a class and an enum of `Panel`. */
@:genes.reactComponent
function App(): Element {
  final tone = Tone.Loud(Counter.next(1));
  final summary = formatCount(Counter.next(0))
    + ' '
    + Std.string(tone)
    + ' '
    + Counter.loaded;
  return <main>
    <Greeting name="refresh" />
    <Panel title="Fast Refresh" />
    {badgeFor(7)}
    <Label text="kept" />
    {Registry.defaultView({text: "registry"})}
    <footer data-summary="">{summary}</footer>
  </main>;
}

/** An ordinary module-level function: `App` is split too. */
function appTitle(): String {
  return "fixture";
}
