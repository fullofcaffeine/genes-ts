package todo.extern;

/** Minimal, precise React Hook externs used by the todo application. */
import todo.web.ReactTypes.ReactDeps;
import todo.web.ReactTypes.State;

/**
 * Imports React's named `useEffect` value without adding a Haxe wrapper.
 *
 * `@:jsRequire` becomes an ordinary ESM named import in both Genes profiles;
 * the extern contributes typing only and emits no runtime implementation.
 */
@:jsRequire("react", "useEffect")
extern function useEffect(effect: Void->Void, deps: ReactDeps): Void;

/**
 * Imports React state while preserving Haxe's exact generic instantiation.
 *
 * Why: TypeScript can infer `null` from `useState(null)` even when Haxe proved
 * the destination is `State<Null<Todo>>`. `@:ts.explicitTypeArguments` tells
 * genes-ts to print the Haxe-selected `Todo | null` argument after `useState`,
 * so the generated TypeScript remains precise and passes its independent
 * strict check. `@:jsRequire` still owns the normal named React import.
 *
 * What/How: `useState((null : Null<Todo>))` emits
 * `useState<Todo | null>(null)`. The annotation is TypeScript-only; classic
 * Genes emits the same plain `useState(null)` runtime call as before.
 */
@:ts.explicitTypeArguments
@:jsRequire("react", "useState")
extern function useState<T>(initial: T): State<T>;
