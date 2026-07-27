package react_hooks;

import genes.react.React.useState;

/**
 * Compiler entry for the deliberately invalid callable-state fixture.
 *
 * Haxe requires a class for `-main`; the invalid operation itself stays in the
 * single entry method so the fixture introduces no all-static API surface.
 */
class CallableState {
  static function main(): Void {
    useState((value: Int) -> value + 1);
  }
}
