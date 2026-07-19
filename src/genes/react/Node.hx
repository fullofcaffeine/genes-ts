package genes.react;

/**
 * Closed semantic marker for a value React may render as a child.
 *
 * Haxe does not have TypeScript's structural union syntax, so HXX validates
 * the concrete scalar, element, nullable, array, and promise cases against
 * this marker without erasing them to `Dynamic`. Generated TypeScript keeps
 * React's canonical `ReactNode` spelling.
 */
@:ts.type("React.ReactNode")
@:genes.jsxNode
extern class Node {}
