# Haxe-authoritative React HXX (`.tsx`, `.jsx`, `.ts`, and `.js`)

genes-ts includes a **compile-time JSX/HXX macro** so you can write TSX-like
markup in Haxe and get idiomatic checked React source in four output profiles.

Key properties:
- **Compile-time only** (no runtime template engine)
- Tags, component props, handlers, spreads, and children are checked by Haxe
  against real Haxe types before any output is committed.
- `{ ... }` interpolations remain real, contextually typed Haxe expressions.
- TypeScript checks `.tsx` and `.ts` output independently as a parity oracle.
- One validated semantic plan emits typed TSX, type-erased JSX, typed
  `createElement`, or equivalent classic JavaScript calls.

## Requirements

- TypeScript source profiles use `-D genes.ts`; classic ESM omits it.
- Install `react` and `react-dom` for runtime execution.
- TypeScript source profiles also need `@types/react` and `@types/react-dom`.
- React 19 projects should add `-D genes.ts.jsx_import_source=react`. Both the
  `.tsx` and typed `.ts` profiles can emit `JSX.Element` annotations; this
  define adds the canonical module-scoped `import type {JSX} from "react"`
  instead of depending on the global namespace removed by React 19. Add the
  same define to classic JavaScript builds that use `-D dts`; their generated
  declarations receive the import while the runtime JavaScript stays
  unchanged.
- Classic inline markup is opt-in with `@:jsx_inline_markup`,
  `-D genes.react.inline_markup`, or `-D genes.react.inline_markup_all`.
  The explicit `jsx("...")` macro already creates marker intent without that
  parser-level opt-in.

## Four output profiles

Genes supports all four from the same HXX source:

1) **TSX mode** (`.tsx` output)
   - Emit `.tsx` and print real TSX markup.
   - Configure TypeScript with `jsx: "react-jsx"` (recommended).

2) **Low-level mode** (`.ts` output)
   - Emit `.ts` and lower JSX into `React.createElement(...)`.
   - Useful when you want plain `.ts` output (or when TSX is undesirable).

3) **JSX mode** (`.jsx` output)
   - Omit `-D genes.ts`; Haxe types are erased while JSX syntax remains.
   - Internal imports use runtime-correct `.js` specifiers for the JSX transform.

4) **Classic JavaScript mode** (`.js` output)
   - Omit `-D genes.ts`; JSX lowers directly to React-compatible runtime calls.

Selection is based on the `-js` output filename extension:

```hxml
# TSX mode
-js src-gen/index.tsx
-D genes.ts
-D genes.ts.jsx_import_source=react

# Low-level mode
-js src-gen/index.ts
-D genes.ts
-D genes.ts.jsx_import_source=react

# Type-erased JSX mode
-js src-gen/index.jsx
-D genes.react.inline_markup

# Classic JavaScript mode
-js src-gen/index.js
-D genes.react.inline_markup
# Required with React 19 when this profile also enables `-D dts`.
-D genes.ts.jsx_import_source=react
```

## Basic usage: `jsx("...")` template

```haxe
import genes.react.JSX.*;

function render(title: String, completed: Bool) {
  return jsx('
    <div className={completed ? "done" : ""}>
      <h1>{title}</h1>
    </div>
  ');
}
```

Supported syntax (intentionally small, TSX-like subset):
- Tags + nested tags
- String attrs (`className="x"`)
- Expr attrs (`onClick={handler}`)
- Boolean attrs (`disabled`)
- Spread attrs (`{...props}`)
- Children as text and `{haxeExpr}`
- Fragments in templates (`<>...</>`)

Notes:
- `jsx(...)` expects a **string literal** (for stable codegen).
- Interpolations are parsed with `Context.parseInlineString(...)`, so `{ ... }`
  must be valid Haxe and diagnostics retain the authored expression span.

## Inline markup (default in TypeScript mode)

Inline markup enables writing:

```haxe
return <div className="x">{title}</div>;
```

The build macro is installed automatically by `-lib genes-ts` (via
`extraParams.hxml`). In `-D genes.ts` builds it rewrites inline markup for every
class by default. Disable it globally with
`-D genes.react.no_inline_markup`, or for a single class with
`@:jsx_no_inline_markup`.

Outside TypeScript mode, the parser rewrite remains opt-in. Use
`@:jsx_inline_markup` for one class, `-D genes.react.inline_markup` for the
scoped switch, or `-D genes.react.inline_markup_all` globally. Once rewritten,
classic Genes consumes the same `JsxPlan` and emits React-compatible
`createElement`/`Fragment` calls; no marker extern remains at runtime.

Example of the narrow opt-in outside TS mode:

```haxe
@:jsx_inline_markup
class MyView {
  function render(title: String) {
    return <div>{title}</div>;
  }
}
```

Haxe inline markup has XML constraints, so prefer `jsx("...")` templates when you
need fragment roots (`<>...</>`) or tags that aren’t valid XML names.

## Output capability table

| Profile | Authoring input | Current lowering contract |
| --- | --- | --- |
| TSX automatic (`.tsx`, `-D genes.ts`) | Inline markup or `jsx("...")` | Emits JSX/TSX after Haxe validation; TypeScript checks parity. Runtime string tags use the planned factory namespace. |
| TSX classic (`.tsx`, plus `-D genes.ts.jsx_classic`) | Inline markup or `jsx("...")` | Emits JSX/TSX plus the required `React` namespace import. |
| TS (`.ts`, `-D genes.ts`) | Inline markup or `jsx("...")` | Lowers to typed `React.createElement(...)`; statically known tags include tag-specific `satisfies` prop checks. |
| JSX (`.jsx`, without `-D genes.ts`) | `jsx("...")`, or opted-in inline markup | Keeps JSX syntax while erasing Haxe types; runtime string tags use the planned factory namespace. |
| Classic Genes JS | `jsx("...")`, or opted-in inline markup | Lowers the same ordered intent to plain React-compatible `createElement(...)`/`Fragment` calls. |

`src/genes/JsxPlan.hx` owns marker recognition, tags/components, ordered
named/spread props, children, fragments, source provenance, and capability
selection before either printer runs. It also distinguishes a direct value
from a Haxe-lifted marker local, so property and child side effects are read
from their evaluated path instead of executing twice.

Those local linked records are compiler scaffolding, not mutable application
objects. Prepare ordinary values first, then use the carrier only in the linked
record path consumed by its marker. Reading it elsewhere, changing one of its
fields, or letting it escape that path fails with `GTS-JSX-INTENT-010`. A pure
pass-through alias remains valid, but mutating the carrier through that alias
does not. This rule matters because property names and list links are checked
at compile time while property and child values are read at runtime; allowing
the record to change could make those two views disagree. The focused
`yarn test:hxx-carrier-immutability` fixture proves that untouched local
carriers still evaluate side effects exactly once in TypeScript and classic
JavaScript, while unsafe use fails before prior output is replaced.

## Canonical source JSX trees

Haxe sometimes lifts nested HXX elements into locals while it types the linked
property and child records. Those locals are useful to the Haxe typer, but in a
source-preserving `.tsx` or `.jsx` file they can make a single authored tree
look machine-generated.

For example, this Haxe:

```haxe
return <div>
  <span>{first}</span>
  <strong>{second}</strong>
</div>;
```

previously retained the compiler's intermediate shape:

```tsx
let span: JSX.Element = <span>{first}</span>;
let strong: JSX.Element = <strong>{second}</strong>;
return <div>{span}{strong}</div>;
```

Source JSX profiles now emit the canonical tree:

```tsx
return <div><span>{first}</span><strong>{second}</strong></div>;
```

This is not general-purpose local-variable optimization. `JsxPlan` permits the
rewrite only when all of these facts are present in the typed Haxe tree:

- the HXX parser marked the nested element or fragment as its own generated
  child; an authored local or ordinary marker call does not carry this fact;
- one exact declaration has one exact use in one direct parent child slot;
- the declaration and parent are in the same function and the same block, in
  source order;
- the parent marker is the direct value of a `return`, a local initializer, or
  an assignment to a local—not something found by searching inside a call,
  object, conditional, or other expression;
- the child and parent contain only values that are safe to move; and
- every block element crossed by the move is reorder-safe. Later generated JSX
  siblings are crossed from right to left only after they are independently
  proven removable.

The parser-owned child marker matters because a source position is only a map
back to the authored file. It does not prove who created an expression: another
macro or an authored declaration can share or copy the same range. The marker
is a typed, compile-only call with the same JSX meaning as the ordinary marker,
so all output profiles still validate and emit the same element. Only the
source cleanup plan uses its distinct typed field identity as provenance.

The safety check deliberately rejects calls, mutation, control flow, dynamic
tags, property and array reads that could invoke JavaScript getters or Proxy
traps, and unresolved spreads. A spread is movable only when it resolves to a
known plain object literal whose values pass the same check. JSX values already
captured by the HXX carrier stay on their evaluated runtime path.

Component tags are intentionally narrower than ordinary safe values. The first
sound version permits only an intrinsic tag such as `div`, a fragment, or a
component already held in a local variable. Every field-based tag stays
explicit, including static methods generated by Haxe. A JavaScript field read
can be supplied by a getter, native mapping, module wrapper, or Proxy, and the
typed Haxe field shape does not prove that read is unobservable. Keeping the
child local preserves the original `Child,Parent` read order. Code may read a
component field into a local first when it wants an explicit, stable lexical
value.

Genes also does not rename the surviving parent merely because a generated
child disappeared. For example, Haxe may call that parent `tree1`; matching
spellings do not prove why Haxe added the suffix. Keeping `tree1` is harmless,
while guessing that `tree` became available can create duplicate JavaScript
declarations. A future name-reclamation feature would need a fact from the
lowering step that actually caused the suffix.

Authored locals remain authored locals, even when they are used once:

```haxe
final child = <span>{label}</span>;
return <div>{child}</div>;
```

Shared children also keep one declaration and multiple reads. If a child would
cross an effectful expression, Genes retains the necessary local and only
normalizes later children that are independently safe. This preserves call,
exception, and property-evaluation order rather than making JSX readability an
optimization that can change behavior.

Nested functions and nested blocks start independent candidate regions. The
planner counts local uses across the whole module so a captured value cannot
look disposable, but it never pairs a declaration and parent from different
functions or blocks. Expected uncertainty is conservative: if any required
fact is missing, Genes simply retains the local.

Accepted facts are checked again before a public output writer is opened. The
check uses the exact typed declaration, initializer, marker field, local-use
occurrence, parent child slot, function, and block recorded for the current
module. A disagreement is a compiler consistency error rather than permission
to fall back to matching names or positions. The source emitter then accounts
for exactly one declaration omission and one child substitution per fact. A
focused injected-failure test proves that a late accounting error leaves the
previous generated tree byte-for-byte unchanged.

These identities live only in one `JsxPlan`; they are never static or reused
between compiler requests. The focused suite also builds an inlineable child,
edits it into an authored local, and restores it through one warm Haxe compiler
server. The middle build must retain the authored local and the restored build
must exactly match the first. This guards against stale object identities or
rewrite decisions surviving a compiler-server request.

The normalization is intentionally limited to profiles that preserve JSX
syntax. Typed `.ts` and classic `.js` still emit the established explicit
`createElement(...)` sequence, so their runtime and snapshot contracts do not
silently change. Both source profiles keep the nested element's original HXX
source-map position.

Verification is owned by:

```bash
yarn test:genes-ts:tsx
yarn test:genes-ts:source-inline-server
yarn test:genes-ts:snapshots
yarn test:genes-ts:sourcemaps
yarn test:output-transaction
yarn test:output-quality
```

The identical-source fixture
`DualJsxMain.hx` renders through TSX, typed createElement, type-erased JSX, and
classic JS under `yarn test:genes-ts:tsx` and compares the resulting HTML
transcript.

A runtime string tag is different from a tag written directly in markup. For
example, migration code may pass a `String` whose value is chosen while the
program runs. HXX still checks that every property value is typed, every spread
is an object, and every child is renderable. Plain TypeScript output preserves
the exact inferred property-object type, but it cannot claim that the object
belongs to one particular HTML tag because that tag is not known yet. Static
tags such as `<a>` and components such as `<Button>` keep their stronger,
tag-specific TypeScript property checks.

## TSX runtime: automatic vs classic

Default expectation:
- TypeScript `jsx: "react-jsx"` (automatic runtime)

If your project uses classic runtime (`jsx: "react"`), add:
- `-D genes.ts.jsx_classic`

This makes genes-ts emit `import * as React from "react"` in `.tsx` modules that
use JSX markers.

Direct createElement profiles use a namespace module selected by:

```hxml
# Default is react; another module must expose compatible runtime and TS types.
-D genes.react.jsx_runtime_module=react
```

`-D genes.react.jsx_runtime_module=none` explicitly disables that capability.
If a module needs direct runtime calls (classic JS, `.ts`, or a dynamic string
tag in automatic TSX), compilation fails with `GTS-JSX-CAPABILITY-001` at the
original Haxe markup position before generated files are committed.

## Return type: `genes.react.Element`

The macro result is typed as `genes.react.Element`, which maps to TypeScript’s
`JSX.Element` in generated TS.

You can annotate your APIs with `genes.react.Element` to keep signatures clean.
When `genes.ts.jsx_import_source` is configured, Genes also emits the matching
type-only `JSX` namespace import for modules that use `Element` only in an API
or local annotation. This applies to both `.ts` and `.tsx` output: such a
module does not need to contain HXX markup merely to make `JSX.Element`
resolvable under strict TypeScript settings.

## Consuming existing components (TSX/JSX)

Use either:
- standard Haxe `@:jsRequire(...)` externs, or
- the macro helper `genes.ts.Imports` (recommended)

See `docs/typescript-target/IMPORTS.md`.

Example (default export):

```haxe
import genes.react.JSX.*;
import genes.ts.Imports;

final Button = Imports.defaultImport("./components/Button.js");

return jsx('<Button label="Save" />');
```

---

## Typechecking behavior (important)

Haxe is the primary checker. A component function's first argument is its exact
prop contract; `genes.react.ComponentType<Props>` and compatible wrappers can
declare a prop type parameter with `@:genes.jsxComponentProps(index)`. HXX uses
that identity to provide contextual callback typing, infer generic props, and
check required, optional, extra, duplicate, spread, and `children` values.
Extern and ordinary Haxe interfaces may extend other property interfaces; HXX
collects their public inherited fields before it checks the tag. This matters
for library contracts that keep common accessibility or callback properties in
a base interface. Closed recursive typedefs are valid too—for example, a tree
node may contain `Array<Node>`. HXX follows the fields once, checks every
concrete value it can observe, and recognizes the repeated typed declaration as
recursion rather than mistaking it for an unresolved type.

A callable component may return a React node directly or a
`js.lib.Promise<Node>`, matching React 19's async component contract. HXX checks
the value inside the promise, so the valid and invalid cases remain distinct
before TypeScript exists:

```haxe
static function AsyncPanel():js.lib.Promise<genes.react.Element> {
  return js.lib.Promise.resolve(<section>Ready</section>);
}

final panel = <AsyncPanel />; // accepted
```

A `Promise<{ label:String }>` is rejected with `GTS-HXX-TAG-003` because the
resolved value is not renderable. Haxe 4.3 reports the standard Promise through
its canonical `js.lib.Promise` module while leaving the class package array
empty; Genes deliberately uses that compiler-owned module identity rather than
guessing from the printed type name.

Zero-runtime Haxe abstracts over a closed property structure preserve that
structure in component arguments and spreads. This makes a typed host facade
usable without exposing an open record:

```haxe
typedef ButtonFields = { final label:String; }

@:forward
abstract ButtonProps(ButtonFields) from ButtonFields {}

final props:ButtonProps = { label: "Save" };
final button = <Button {...props} />;
```

HXX follows only a non-core abstract chain that terminates in an anonymous
record. It does not structurally erase nominal enum abstracts into their shared
primitive representation: a string literal outside an enum abstract's closed
constructors still fails the declared property contract. A scalar or callable
abstract is not spreadable, and a closed record abstract carrying `label:Int`
still fails against `label:String` with `GTS-HXX-SPREAD-002`. There is no
reflective field discovery, cast, or permissive catch-all.

Property contracts must remain concrete all the way through their nested
fields. HXX rejects `Dynamic`, Haxe's core `Any`, and `genes.ts.Unknown` in both
supplied values and declared component or intrinsic schemas; supplied values
also cannot rely on an unresolved monomorph. Fresh inference variables on a
generic component are different: Haxe binds them from checked HXX arguments,
so generic components retain their ordinary inference. Attribute-prefix
declarations follow the same rule because their one field type is the complete
contract for every matching property. A value typed as `Null<T>` fills only a
nullable or union contract; it cannot fill a required non-null `T` merely
because Haxe's JavaScript target can unify those types. `@:optional` spread
fields remain distinct from explicit nullable values: they represent possible
omission and are checked against required-field rules.

HXX keeps three absence contracts separate:

- `@:optional` means that an object may omit the property;
- `Null<T>` means that a supplied value may be Haxe `null`;
- `genes.ts.Undefinable<T>` means that a supplied host value may be JavaScript
  `undefined`.

For example, a required `Undefinable<String>` property must still be present,
and `Null<String>` cannot fill it. The bundled React DOM provider opts into
explicit `undefined` for its optional properties because React's TypeScript
definitions accept that form. This opt-in removes only the outer `Null<T>` that
Haxe adds internally for an optional field: a supplied Haxe `null` still fails
when React expects `T | undefined`. A provider can spell
`Undefinable<Null<T>>` when its real host contract intentionally accepts both.
A custom intrinsic provider keeps ordinary Haxe optional/null behavior unless
its class declares `@:genes.jsxOptionalValuesAllowUndefined`.

HXX also distinguishes a child that **might** come from a spread from one that
is **definitely** present. This matters when the component requires a child.
For example, this `Card` always needs one React element:

```haxe
typedef CardProps = {
  final children: genes.react.Element;
}

typedef MaybeChildren = {
  @:optional
  var children: genes.react.Element;
}

function Card(props: CardProps): genes.react.Element {
  return <section>{props.children}</section>;
}

final props: MaybeChildren = {};
final card = <Card {...props}><strong>nested child</strong></Card>;
```

`@:optional` means the field may be missing, so the spread alone cannot satisfy
`Card`'s required child. The nested `<strong>` supplies that required value. If
`props.children` is present, the nested child still wins because it comes after
the spread. TSX keeps that source order; typed `createElement` output places the
nested value last in the checked property object; classic `createElement`
passes it after the property object. All three forms therefore give `Card` the
same final child.

### Choose `Element` or `Node` based on the real child contract

`genes.react.Element` and `genes.react.Node` answer different questions:

- `Element` means exactly one JSX element, such as `<strong>Save</strong>`;
- `Node` means anything React may render, including text, an element, an array,
  a promise accepted by the selected React types, or several nested children.

Use `Element` when the component genuinely requires one element wrapper. HXX
then rejects text, a missing child, and several separately authored children.
The rule also works through a typedef alias or a class that extends `Element`,
so library-specific element facades keep normal Haxe subtype behavior.

Use `Node` when the component deliberately accepts React's wider child
algebra. Do not widen an exact property to `Node` merely to silence a child
diagnostic; that changes the component's public contract. These checks happen
while HXX validates the Haxe source. Generated TSX still uses the selected
React runtime's ordinary `JSX.Element` and `ReactNode` types as a second,
independent TypeScript check.

`@:ts.optional` is not needed for this presence rule. That separate annotation
controls whether an optional value is represented with JavaScript
`undefined` in generated TypeScript. A direct `children={...}` property or a
required `children` field in a spread is definitely present, so combining
either one with nested markup still reports `GTS-HXX-CHILD-004`.

Array-shaped child contracts follow React's actual runtime shape. With
`children: Array<Item>`, one nested expression must itself be an `Array<Item>`:

```haxe
<List>{items}</List>
```

Two or more separately written children are collected into that array. One
scalar child is rejected because React would pass the scalar directly; it does
not create a one-item array automatically. Write `{[item]}` when a one-item
array is intended.

An imported extern class can name a closed property contract directly. This is
useful when `@:jsRequire` represents a React component as a class value rather
than a Haxe function:

```haxe
@:genes.compilerInternal
@:genes.semanticOnly
typedef LinkProps = {
  final to: String;
  final children: genes.react.Node;
}

@:jsRequire("react-router-dom", "Link")
@:genes.jsxComponentProps("my.extern.ReactRouter.LinkProps")
extern class Link {}
```

The string must be a fully qualified Haxe type path. It is resolved by Haxe at
compile time; it is not emitted or interpreted at runtime. Both the generic
index and type-path forms fail closed when the referenced contract is missing,
open, or unsafe. `@:genes.compilerInternal` keeps an ordinary alias available
to generated code while hiding it from exports and declarations.
`@:genes.semanticOnly` is the narrower opt-in used above: it says the checker
is the only consumer and no emitted annotation may name the alias. Do not add
that second annotation to a type used by generated local code.

Direct generic function components keep Haxe's inferred property type in the
plain `.ts` createElement profile. For example, a checked call to
`GenericValue<Int>` emits `createElement<GenericValueProps<number>>(...)`
instead of allowing React's utility type to widen the generic argument to
`unknown`. If HXX cannot determine every generic parameter, it leaves the
specialization to React rather than printing a type parameter that is not in
scope.

Lowercase tags are resolved through the typed
`genes.react.IntrinsicElements` provider. A JSX runtime can replace it with a
comma-separated provider list:

```hxml
-D genes.react.jsx_intrinsic_providers=my.ui.IntrinsicElements
```

Provider fields use `@:genes.jsxIntrinsic("tag-name")`; prefix fields use
`@:genes.jsxAttributePrefix("data-")`. The field type—not its metadata
spelling—is the Haxe prop/value contract. Unknown tags and unresolved contracts
fail closed rather than falling back to a permissive top type. A provider also
cannot declare the same prefix twice: competing value types would make the
accepted contract depend on field order, so HXX reports
`GTS-HXX-SCHEMA-007` at the duplicate declaration. A weak component, intrinsic,
or prefix field fails with `GTS-HXX-SCHEMA-008` before its type can erase HXX's
compile-time guarantees. Prefixes such as `data-` and `data-count-` may not
overlap (`GTS-HXX-SCHEMA-009`), because the chosen contract would otherwise
depend on provider field order. A schema-changing annotation may appear only
once on a field (`GTS-HXX-SCHEMA-010`).

The bundled provider is deliberately a reviewed common subset, not a loose
copy of every version of `@types/react`. If an application needs another valid
attribute, extend a typed provider or contribute the missing generic contract.
Do not work around a missing field with `Dynamic`, a cast, or a raw TypeScript
type string: those approaches would move the error past Haxe again.

The common SVG contract uses React's camelCase authoring names and accepts the
same closed string-or-number shape for dash presentation values:

```haxe
final pattern = "8 4";
final offset = 2.5;
final gauge = <circle
  strokeDasharray={pattern}
  strokeDashoffset={offset}
/>;
```

Haxe checks both values before output. TSX keeps `strokeDasharray` and
`strokeDashoffset`, while React writes the native `stroke-dasharray` and
`stroke-dashoffset` names when rendering DOM or server markup. A Boolean or
other unrelated value fails at its HXX attribute rather than being deferred to
TypeScript.

Native dialogs have a similarly focused contract. The bundled provider accepts
React 19's `open`, `closedby`, `onCancel`, and `onClose` properties while still
rejecting undeclared fields:

```haxe
final modal = <dialog
  open
  closedby="any"
  onCancel={event -> event.currentTarget.close()}
  onClose={handleAnyElementClose}
>Review changes</dialog>;
```

`open` is a checked `Bool`, so `<dialog open="yes">` fails with
`GTS-HXX-PROP-002` at the HXX attribute. The lifecycle callbacks receive
`SyntheticEvent<js.html.DialogElement>` in Haxe and preserve React's
`SyntheticEvent<HTMLDialogElement>` spelling in typed output. This is a
compile-time schema only: TSX/JSX keep the native `<dialog>` markup, and typed
or classic `createElement` profiles pass the same ordinary property object
without a wrapper or helper.

A named callback that accepts `SyntheticEvent<genes.react.DomElement>` is also
safe: every dialog is an HTML element, so the broader handler can work with the
more specific event. HXX accepts that direction but rejects a callback that
requires an unrelated target such as `InputElement`.

Intrinsic refs use the same Haxe-first contract. A callback receives the
mounted element or `null`. Tags with a focused schema—currently anchors,
dialogs, and inputs—carry that exact element identity:

```haxe
final field = <input ref={element -> {
  if (element != null)
    element.select();
}} />;
```

Here Haxe checks `element` as `Null<js.html.InputElement>` before output.
Passing a string, an anchor-only callback, or another incompatible target
fails with `GTS-HXX-PROP-002` at the `ref` value. The closed schema also models
React ref objects, an explicit `ref={null}`, and React 19's optional callback
cleanup result. Omission, JavaScript `undefined`, and an authored `null` remain
separate facts even though Haxe normally represents optional fields with an
outer `Null`.

The remaining HTML tags use the safe common `HTMLElement` boundary, while SVG
tags use the separate `SVGElement` boundary. A callback accepting one of these
broader family types is safe for every tag in that family; it does not pretend
that a `<li>` is an input or that an SVG node is an HTML element. Object refs
are accepted when their element type matches the tag schema's boundary. More
tag-specific facades should be added only with a concrete authoring case and a
focused fixture.

In TSX and JSX, the authored `ref={...}` stays ordinary markup. Typed
`createElement` uses `ComponentPropsWithRef<"input">` for this intrinsic (and
`ComponentPropsWithRef<typeof Component>` for component values), so strict
React declarations verify the same property independently. Classic JavaScript
passes the callback unchanged. No wrapper component, ref adapter, or runtime
class is generated.

This capability was added after an accessible headless drag-and-drop Hook in
NextJsHx returned callback refs that HXX could not attach to native elements.
The fix is deliberately React-generic: the intrinsic schema and browser
element identity relationship contain no package or downstream framework
knowledge.

Default React event contracts retain their element parameter. For example, an
`<input>` callback contextually receives
`genes.react.ChangeEvent<js.html.InputElement>`, so the complete standard Haxe
DOM surface—including methods such as `setSelectionRange`—is checked before
output exists and is emitted as React's canonical
`ChangeEvent<HTMLInputElement>`. Anchor events similarly retain
`js.html.AnchorElement`/`HTMLAnchorElement`. Genes' focused compatibility
facades provide stable schema identities, while contextual inline callbacks are
projected to those complete standard externs. Genes does not publish browser
typedef modules merely because Haxe loaded them while resolving an ambient
extern: a type-only module must be named by emitted syntax or explicitly
exported before it becomes reachable. Existing annotated handlers may name the
standard DOM extern directly. HXX compares compiler-owned browser identities
rather than a printed type string. A callback may intentionally
omit supplied event parameters or return a value when the consumer expects
`Void`, matching JavaScript/TypeScript callback subtyping. The reverse is not
safe: a callback that requires an argument cannot fill a contract whose caller
may omit that argument. Declared parameters are checked contravariantly, and
incompatible event targets fail in Haxe even when their extern wrappers have no
runtime fields. HXX still rejects weak callback parameters and observable
return values. It ignores only a result paired with an expected `Void`, because
the caller has explicitly promised not to read that result; this lets an event
handler start a typed async boundary without exposing the boundary value as a
component property.

Contravariance also applies inside the reviewed React event wrappers. An
anchor click supplies `MouseEvent<AnchorElement>`, so all of these handlers are
safe: the exact type, `MouseEvent<DomElement>`,
`SyntheticEvent<AnchorElement>`, and `SyntheticEvent<DomElement>`. Each handler
can receive every value the anchor property may send. The reverse directions
remain errors: a generic DOM event cannot satisfy a handler that requires an
anchor, and a generic synthetic event cannot satisfy one that requires a mouse
event. Sibling event families and sibling element targets are unrelated. HXX
uses the typed event and element inheritance graphs plus its explicit mapping
between Genes' small facades and Haxe's standard DOM externs; it never guesses
from generated TypeScript names or the fields present on an empty extern.

`yarn test:hxx-event-variance` owns this boundary. It exercises broader event
families, browser and ordinary Haxe target inheritance, narrow/sibling
rejection, canonical TypeScript 5/6/7 output, both runtimes, and failed-build
rollback.

## React 19 form actions

React 19 accepts either a URL or a function on `<form action>`,
`<button formAction>`, and `<input formAction>`. The function receives exactly
one browser `FormData` value and may return `Void` or `Promise<Void>`. Genes
models that complete union in the intrinsic schema, so Haxe validates the
action before TSX or `createElement` output exists:

```haxe
static function save(data: js.html.FormData): js.lib.Promise<Void> {
  data.has("title");
  return js.lib.Promise.resolve();
}

final form = <form action={save}></form>;
final alternate = <button formAction={save}>Save</button>;
```

String actions remain valid:

```haxe
final form = <form action="/search"></form>;
```

The callback result is one function returning a closed union—not a union of
separate functions. This distinction ensures that an invalid
`Promise<String>` result cannot be accepted by the ordinary rule that permits
callers to ignore a synchronous callback result. Wrong parameter types, extra
required parameters, and structurally similar but unrelated host facades fail
with `GTS-HXX-PROP-002` at the authored attribute.

Sometimes a library needs a focused facade for a browser global whose Haxe
standard-library declaration is older or broader. Such an extern can declare
the same native host identity explicitly:

```haxe
@:native("FormData")
@:ts.type("globalThis.FormData")
extern class PreciseFormData {
  function has(name: String): Bool;
}
```

Two extern classes with the same literal global `@:native` name and no
`@:jsRequire` are treated as views of the same host type. Generic arguments
remain invariant. Matching method names alone do not establish identity, and a
different native global such as `URLSearchParams` remains incompatible. This
rule is framework-neutral and never compares generated TypeScript strings.

This support was added after a Next.js Server Function form—valid under React
19—failed early in HXX because the bundled intrinsic schema still allowed only
a string action. The implementation remains a general React/host-extern
capability; it contains no Next.js-specific behavior. See React's official
[`<form>` reference](https://react.dev/reference/react-dom/components/form).

Renderable children include the closed `genes.react.OneOf*` carriers and
standard `haxe.extern.EitherType` unions. Domain abstracts backed by a React
scalar remain renderable without erasing their Haxe identity.

Keep `tsc --noEmit` and strict React typings in CI for `.tsx`/`.ts`. They prove
that Haxe-derived output still matches the real consumer ecosystem, but an
invalid HXX program must already have failed in Haxe.

### Negative Haxe evidence

Negative fixtures compile one invalid HXX operation at a time and assert its
stable source-positioned diagnostic. For example:

```haxe
final bad = <Button label={123} />;
// [GTS-HXX-PROP-002] component `Button` property `label` expects `String`
// but received `Int`.
```

The repository covers tag typos, component identity/return types, missing,
extra, duplicate and wrong props, unsafe keys, weak schemas and nested values,
nullable-to-required assignments, handler target/optionality, required and
unexpected children, non-renderable children, and invalid spreads before any
TypeScript lane runs. The focused diagnostic-range gate checks the exact
authored start and end columns for representative tag, property value, spread,
nested-child, and provider-metadata failures—not merely the source filename or
line. It runs on the supported Haxe release and the configured Haxe preview,
and each failed compile must leave the output transaction empty. Positive
alias, generic, inherited-interface, wrapper, nullable, recursive, prefix,
custom-provider, packed-release, and runtime fixtures run beside the negative
controls. A separate carrier-ownership fixture rejects post-construction
prop/child mutation, including mutation through a marker-bound alias, with
`GTS-JSX-INTENT-010` while retaining the last committed output. Provider
coverage is explicit and extensible; it is not a claim that every third-party
JSX namespace is built in.
