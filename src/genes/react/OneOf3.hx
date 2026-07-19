package genes.react;

/**
 * Closed three-way union for properties such as React's `key`.
 *
 * The HXX checker reads the three generic members from `@:genes.jsxUnion`;
 * `@:ts.type` preserves the matching TypeScript union. No runtime class exists.
 */
@:genes.jsxUnion
@:ts.type("$0 | $1 | $2")
extern class OneOf3<A, B, C> {}
