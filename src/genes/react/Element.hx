package genes.react;

/**
 * Type-only representation of a React element for genes-ts output.
 *
 * Why: Haxe APIs need a concrete return type for components even though a
 * React element is created by the selected JSX runtime.
 *
 * What: the class is also a renderable `Node`, so it may be used as a child.
 *
 * How: `@:genes.jsxNode` admits it to HXX's closed child algebra, while
 * `@:ts.type` prints `JSX.Element` for `.ts` and `.tsx`. This extern does not
 * allocate or modify a runtime value.
 */
@:ts.type("JSX.Element")
@:genes.jsxNode
extern class Element extends Node {}
