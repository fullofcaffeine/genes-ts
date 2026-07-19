package genes.react;

/**
 * Closed two-way union used by built-in HXX property declarations.
 *
 * Haxe has no ordinary `A | B` type. `@:genes.jsxUnion` tells the HXX checker
 * to try each generic member, while `@:ts.type` prints the equivalent
 * TypeScript union. This extern has no value or runtime behavior.
 */
@:genes.jsxUnion
@:ts.type("$0 | $1")
extern class OneOf2<A, B> {}
