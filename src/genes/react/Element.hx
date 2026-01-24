package genes.react;

/**
 * Type-only representation of a React element for genes-ts output.
 *
 * This maps to TypeScript's `JSX.Element` so generated `.ts` and `.tsx` can be
 * type-checked under React's standard typings without depending on a dedicated
 * Haxe React library.
 */
@:ts.type("JSX.Element")
abstract Element(Dynamic) from Dynamic to Dynamic {}

