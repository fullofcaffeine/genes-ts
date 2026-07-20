package genes.react;

/**
 * Closed semantic marker for a value React may render as a child.
 *
 * Why: Haxe does not have TypeScript's structural ReactNode union syntax.
 *
 * What: HXX validates scalar, element, nullable, array, and promise values
 * against this broad marker without erasing them to `Dynamic`. A property
 * typed `Node` may therefore receive one or several renderable children.
 *
 * How: `@:genes.jsxNode` selects the broad child-algebra branch during HXX
 * checking, while `@:ts.type` prints React's canonical `React.ReactNode`.
 * Exact element contracts use `@:genes.jsxElement` instead, so the two
 * metadata forms must not be treated as interchangeable.
 */
@:ts.type("React.ReactNode")
@:genes.jsxNode
extern class Node {}
