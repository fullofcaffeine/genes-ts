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

## State, context, refs, effects, and dependencies

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
`useMemo`, `useCallback`, or `useEffect`; genes emits one inline,
constant-length dependency array. Every dependency must have a closed,
resolved Haxe type.

Common React boundaries use the same direct-import design:

```haxe
import genes.react.Context;
import genes.react.React.deps;
import genes.react.React.createContext;
import genes.react.React.useContext;
import genes.react.React.useEffect;
import genes.react.React.useRef;

final Theme:Context<String> = createContext("light");

@:genes.reactHook
function useButtonTheme():String {
  final theme = useContext(Theme);
  final button = useRef((null : Null<js.html.ButtonElement>));

  useEffect(() -> {
    final element = button.current;
    if (element != null) element.setAttribute("data-theme", theme);
  }, deps(button, theme));

  return theme;
}
```

`Context<Value>` and `RefObject<Value>` retain the selected value/element types
and emit React's canonical TypeScript types. `useEffect` accepts a
zero-argument callback returning either `Void` or one `Void->Void` cleanup
callback; any other return fails with `GTS-REACT-EFFECT-001`. These APIs add no
context, ref, or effect wrapper at runtime.

Empty-array state also retains the Haxe-selected element type:

```haxe
final items = useState(([] : Array<Item>));
```

Genes emits `useState<Item[]>([])` so TypeScript does not independently infer
the narrower `never[]`.

A local `State<T>` also selects the exact React state value type. This matters
when the initializer is narrower than the state values that the Hook accepts:

```haxe
final cat:Cat = makeCat();
final dog:Dog = makeDog();
final animal:State<Animal> = useStateLazy(() -> cat);
animal.set(dog);
```

Genes emits `useState<Animal>(() => cat)` in TypeScript and TSX. TypeScript
therefore does not infer `Cat` and reject the later `Dog` replacement. The
classic JavaScript and JSX profiles emit `useState(() => cat)` with no type
syntax. An unannotated local still uses its inferred Haxe type, such as `Cat`.

The local type is also the authority for a generic enum initializer. A
`State<Choice<Int, String>>` local emits
`useState<Choice<number, string>>(Choice.Left<number, string>(1))`. Genes waits
until Haxe has closed both enum parameters before it prints this witness.

When a dependency is a computed expression or an allocation-free tuple
projection such as `state.value`, give the `useMemo` calculation one parameter
for each dependency:

```haxe
final summary = useMemo(
  (current, normalizedLabel) -> '$normalizedLabel:${current * 2}',
  deps(state.value, label.toUpperCase())
);
```

Genes evaluates each dependency expression exactly once, assigns it to the
corresponding typed render-local name, and uses that same name in both the
zero-argument React calculation and its dependency array. This preserves
evaluation order while making the relationship visible to React's official
lint. A computed dependency used by a zero-argument calculation fails with
`GTS-REACT-DEPS-002` rather than emitting analyzer-hostile code. Parameter
arity, exact annotated types, optional/default/rest forms, and named recursive
functions are also checked before output.

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

For a module whose main job is one component, give the file and function the
same name. Haxe keeps the module path and the function field distinct, so this
is valid and gives both languages the name a reader expects:

```haxe
// views/WorldArchive.hx
package views;

import genes.react.Element;
import genes.react.JSX.*;

typedef WorldArchiveProps = {
  final bundleName:String;
}

@:genes.reactComponent
function WorldArchive(props:WorldArchiveProps):Element {
  return <article>{props.bundleName}</article>;
}
```

Import the function from the module, then use it as an ordinary HXX component:

```haxe
import views.WorldArchive.WorldArchive;

return <WorldArchive bundleName="Bedrock" />;
```

When the local name is already occupied, alias the function at the Haxe import
boundary:

```haxe
import views.WorldArchive.WorldArchive as WorldArchiveView;

return <WorldArchiveView bundleName="Bedrock" />;
```

Both imports select the same generated ESM binding. The direct generated TSX
shape is:

```tsx
export function WorldArchive(
  props: WorldArchiveProps,
): JSX.Element {
  return <article>{props.bundleName}</article>;
}
```

Genes does not emit a holder class, a static assignment bridge, or Haxe class
registration for a disposable module owner. The component remains removable
by Haxe dead-code elimination when nothing references it. A conservative
unused `genes.Register` import may still appear in some direct-function
modules; the framework-neutral helper-import planner is tracked separately and
does not change component identity or runtime behavior.

The annotations are compile-time contracts:

- `@:genes.reactComponent` requires an uppercase module function or public
  static method; a variable that stores a function value is not a function
  declaration and cannot receive analyzer-visible module-function lowering;
- an ordinary component accepts zero arguments or one ordinary props argument
  and returns the exact `genes.react.Element` contract, an element subtype, or
  `Null<Element>` when it may intentionally render nothing; this does not admit
  the broader `Node` child algebra; a rest parameter would become a variadic
  JavaScript function rather than React's one-props-value component shape, so
  Genes rejects it;
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

The ordinary component marker intentionally does not accept a second legacy
context/ref argument or a promise return. `forwardRef`, async/server
components, and other React callable roles need separate typed contracts so
Genes does not silently claim that every callable shape has the same Hook and
analyzer rules.

Inline markup is a build-profile capability, not another component role.
TypeScript profiles enable it automatically. Classic JSX and JavaScript
profiles enable `genes.react.inline_markup` in HXML so the same `.hx` source
works unchanged. Do not add `@:jsx_inline_markup` to an ordinary TSX component,
and do not add `@:genes.moduleFunction` beside `@:genes.reactComponent`.

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

A module containing only selected module functions omits Haxe's synthetic
module-field owner. If the module also declares an ordinary runtime field or an
initializer with side effects, Genes keeps the owner because removing it would
change the Haxe program. The React function remains a genuine named export in
either case, so React's official analyzers inspect the real body directly.

## Verification

Run the focused dual-profile contract:

```bash
yarn test:react-hooks
```

It compiles strict TypeScript across the supported TypeScript lanes and classic
JavaScript/declarations, checks direct React imports and analyzer-visible
functions, verifies context/ref/effect typing, cleanup preservation,
computed-dependency exactly-once snapshots, deterministic output, and exact
source-map mappings, and asserts callable-state, effect-result,
dependency-snapshot, and Hook-placement failures. The fixture includes an
ordinary React component and a Gutenberg-shaped block editor with no
framework-specific compiler knowledge.
