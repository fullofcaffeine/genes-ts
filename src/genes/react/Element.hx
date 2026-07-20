package genes.react;

/**
 * Type-only representation of a React element for genes-ts output.
 *
 * Why: Haxe APIs need a concrete return type for components even though a
 * React element is created by the selected JSX runtime.
 *
 * What: the class is also a renderable `Node`, so it may be used as a child.
 * Unlike `Node`, an `Element` property still means exactly one element; text,
 * arrays, and several nested children are not assignable to that contract.
 *
 * How: `@:genes.jsxElement` admits concrete values to HXX's closed child
 * algebra without selecting the broad `ReactNode` validation branch.
 * `@:ts.type` prints `JSX.Element` for `.ts` and `.tsx`. Both annotations are
 * compile-time projections; this extern does not allocate or modify a value.
 */
@:ts.type("JSX.Element")
@:genes.jsxElement
extern class Element extends Node {}
