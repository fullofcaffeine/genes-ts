# React Hook authoring

genes provides a framework-neutral React authoring layer under `genes.react`.
It is usable by ordinary Haxe React applications, Gutenberg integrations, and
frameworks that compile through genes. It does not know about Next.js routes,
Server Components, or any other host convention.

## Why this layer exists

React's native API is intentionally JavaScript-shaped:

- `useState` accepts either a value or a lazy initializer;
- its dispatcher accepts either a replacement or an updater;
- Hook dependencies are ordinary arrays;
- React and its lint identify components and custom Hooks from real module
  functions and naming/placement rules.

Those shapes are faithful at an extern boundary, but Haxe can express the
author's intent more precisely. The semantic layer separates the ambiguous
operations and rejects locally provable Rule-of-Hooks errors before output.
Generated code still imports and calls the real React functions directly.

## State and dependencies

```haxe
import genes.react.React.deps;
import genes.react.React.useMemo;
import genes.react.React.useState;

@:genes.reactHook
function useCounter(initial:Int):Int {
  final state = useState(initial);
  final value = state.value;
  final doubled = useMemo(
    () -> value * 2,
    deps(value)
  );

  state.set(4);                  // replace
  state.update(old -> old + 1); // update
  return doubled;
}
```

`useState(value)` rejects a static type that may be callable, because
React would execute it as a lazy initializer. Use
`useStateLazy(() -> value)` for deliberate lazy initialization and use
the semantic `State.set` method to store a callable value safely.

`deps(...)` is compile-time packaging. It must appear directly in
`useMemo` or `useCallback`; genes emits one inline, constant-length dependency
array. Every dependency must have a closed, resolved Haxe type.

`useOptimistic` returns an allocation-free `Optimistic<State, Action>`
view with `value` and `apply(action)`.

## Components and custom Hooks

Use module-level functions for ordinary components and Hooks. Named imports
mirror idiomatic React TypeScript, keep call sites concise, and avoid a
redundant all-static Haxe class:

```haxe
import genes.react.React.useState;

@:genes.reactComponent
function Counter(props:CounterProps):Element {
  final count = useState(props.initial);
  return <button onClick={() -> count.update(value -> value + 1)}>
    Count {count.value}
  </button>;
}

@:genes.reactHook
function useCounter(initial:Int):State<Int> {
  return useState(initial);
}
```

The annotations are compile-time contracts:

- `@:genes.reactComponent` requires an uppercase module function or public
  static method;
- `@:genes.reactHook` requires a `use...` module function or public static
  method;
- genes derives `@:genes.moduleFunction` internally, so React's analyzers see a
  genuine named module function;
- reviewed Hooks may run only at the top level of a marked component or Hook;
- conditionals, loops, nested callbacks, `try`/`catch`, and calls after a
  conditional early return fail at the Haxe source span;
- known render-time mutations and non-idempotent calls receive focused
  diagnostics.

Imported Hook externs may use `@:genes.reactHook` to join the same placement
contract. Names alone never classify an ordinary function as a Hook.

An existing static method remains supported when the class has a real job:
class identity, an interface, inheritance, stateful construction, required
metadata, or an exact host export contract. Do not add a class merely to hold
static React functions.

## Generated behavior

The semantic state and dependency views erase to React's existing values:

```ts
import { useState, useMemo } from "react";

export function useCounter(initial: number): number {
  const state = useState(initial);
  const value = state[0];
  return useMemo(() => value * 2, [value]);
}
```

There is no alternate Hook runtime, tuple wrapper, dispatcher registry, or
framework adapter. TypeScript/TSX and classic JavaScript use the same canonical
React module identity and evaluation order.

Today the generated module also retains a compiler-owned module-field
descriptor class used by Haxe identity and dependency planning. The public
React function itself is a genuine named module export, so React's official
analyzers can inspect it directly. Removing that remaining synthetic
module-field class is a separate, framework-neutral Genes compiler improvement;
this React API does not hide it behind another runtime wrapper.

## Verification

Run the focused dual-profile contract:

```bash
yarn test:react-hooks
```

It compiles strict TypeScript across the supported TypeScript lanes and classic
JavaScript/declarations, checks direct React imports and analyzer-visible
functions, verifies deterministic output and exact source-map mappings, and
asserts callable-state plus Hook-placement failures. The fixture includes an
ordinary React component and a Gutenberg-shaped block editor with no
framework-specific compiler knowledge.
