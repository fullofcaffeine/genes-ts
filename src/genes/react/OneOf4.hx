package genes.react;

/**
 * Closed four-way union for built-in React attribute contracts.
 *
 * The HXX checker reads the generic members from `@:genes.jsxUnion`, and
 * `@:ts.type` prints their TypeScript union. The extern is compile-time only.
 */
@:genes.jsxUnion
@:ts.type("$0 | $1 | $2 | $3")
extern class OneOf4<A, B, C, D> {}
