package genes.react;

/**
 * Type-only view of one React context.
 *
 * `createContext` creates the runtime value. This declaration preserves its
 * selected value type in Haxe and projects React's canonical public type in
 * generated TypeScript without emitting a wrapper class.
 */
@:ts.type("import('react').Context<$0>")
extern class Context<Value> {}
