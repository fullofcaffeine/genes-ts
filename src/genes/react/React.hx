package genes.react;

#if macro
import haxe.macro.Expr;
#end

/**
 * Intent-oriented React Hook surface for Haxe applications.
 *
 * These macros strengthen authoring-time contracts while lowering to direct
 * React imports. They do not introduce a React wrapper runtime.
 */
/** Creates state from a definitely eager value. */
macro function useState(initial: Expr): Expr {
  return ReactHooksMacro.useState(initial);
}

/** Creates state from a deliberately lazy initializer. */
macro function useStateLazy(initializer: Expr): Expr {
  return ReactHooksMacro.useStateLazy(initializer);
}

/** Memoizes one calculation against an inline dependency list. */
macro function useMemo(calculate: Expr, dependencies: Expr): Expr {
  return ReactHooksMacro.useMemo(calculate, dependencies);
}

/** Memoizes one callback against an inline dependency list. */
macro function useCallback(callback: Expr, dependencies: Expr): Expr {
  return ReactHooksMacro.useCallback(callback, dependencies);
}

/** Creates a typed optimistic projection and action dispatcher. */
macro function useOptimistic(passthrough: Expr, reducer: Expr): Expr {
  return ReactHooksMacro.useOptimistic(passthrough, reducer);
}

/**
 * Packages dependencies for one semantic memo Hook.
 *
 * This marker is compile-time-only and is legal only directly inside
 * `useMemo` or `useCallback`.
 */
macro function deps(arguments: Array<Expr>): Expr {
  return ReactHooksMacro.deps(arguments);
}
