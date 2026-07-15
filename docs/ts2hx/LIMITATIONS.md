# ts2hx limitations and evidence boundary

ts2hx is an experimental TypeScript/JavaScript implementation-source migration
tool. It is useful because it now fails closed, records every input file, and
has exact semantic differentials for a bounded subset. It is not a general or
lossless TypeScript-to-Haxe compiler.

This document states what current success means, where translation is
approximate or unsupported, and which repository gate owns each confidence
level. The machine-readable source of truth for semantic feature contracts is
`tools/ts2hx/src/semantic/ir.ts`; every translation copies that complete matrix
into `ts2hx-manifest.json` and annotates features exercised by the run.

## What each result means

| Result | Output-tree contract | Semantic claim |
| --- | --- | --- |
| `strict-js` success, exit `0` | Every configured root file has an emitted or declaration-only disposition; the complete tree and manifest are committed atomically. | Only encountered constructs recognized by the current strict subset are accepted. Runtime parity still requires a differential. |
| `strict-js` failure, exit `1` | No generated file is committed and the prior output directory is preserved byte-for-byte. An external diagnostics manifest may still be written. | At least one construct is known to be unsupported or lossy. |
| `assisted`, exit `3` | Partial scaffolding and its loss manifest are committed together; unsupported source has stable markers/dispositions. | No executable or parity claim. |
| `assisted --allow-loss`, exit `0` | Identical assisted tree and manifest; only the shell status changes. | Still no executable or parity claim. |
| CLI/config/internal failure, exit `2` | No translation-success claim. | Fix the tool invocation, project configuration, or internal error first. |

Exit `0` is not proof that arbitrary TypeScript has a Haxe equivalent. A new
syntax path can be accepted only after the emitter recognizes it; a robust
semantic claim additionally needs original-TS versus generated-runtime
evidence.

## Evidence ladder

| Evidence | What it detects | What it does not prove |
| --- | --- | --- |
| TypeScript Program/TypeChecker load | The config parses and symbols/types are available to the translator. | `--diagnostics` does not itself fail translation on every TS type error; run the source `tsc` gate separately. |
| File dispositions and deterministic manifest | No configured root file or known unsupported statement silently disappears. | The emitted behavior is correct. |
| Snapshot comparison | Stable generated Haxe shape for registered syntax fixtures. | Runtime semantics; a stable approximation can still be wrong. |
| Haxe compile smoke | Generated Haxe parses and types on the exercised JS profile. | Runtime behavior or non-JS portability. |
| Runtime smoke | A selected generated entry executes and prints its marker. | Edge cases or behavioral equivalence with the original TypeScript. |
| Roundtrip smoke | Original TS and Haxe→genes-ts→TS execute selected common workflows; guarded user modules avoid `any`/`unknown`. | Whole-program parity; the three fixtures explicitly exclude one unsupported top-level entry file each. |
| Semantic differential | The original TS, classic Genes JS, and genes-ts→JS event traces match for 14 declared contracts. | Syntax/categories outside those contracts. |
| Strict diagnostics/transaction test | Unsupported source receives stable spans/IDs and cannot leave a partial output tree. | That the unsupported feature has been implemented. |

## Current semantic support matrix

Grades describe the emitted Haxe contract:

- `P0`: ordinary Haxe shape for the exercised behavior;
- `J1`: behavior preserved for JavaScript through a named helper or JS-specific
  runtime contract;
- `U`: rejected in strict mode;
- `A`: assisted loss, applied per affected file rather than as a support grade.

| Feature ID | Support / grade | Current boundary |
| --- | --- | --- |
| `values.explicit-undefined` | helper / J1 | Preserves real JavaScript `undefined`, distinct from `null`. |
| `parameters.undefined-default` | helper / J1 | Runs defaults only for omission/exact `undefined`, not explicit `null`. |
| `locals.uninitialized` | helper / J1 | Requires an explicit source type; inferred uninitialized locals are rejected. |
| `coercion.truthiness` | helper / J1 | Uses JavaScript Boolean coercion for supported conditions/logical expressions. |
| `coercion.strict-equality` | helper / J1 | Preserves strict equality and switch identity. |
| `coercion.unary-plus` | helper / J1 | A typed `genes.js.Coercion` boundary expands to native unary `+` in both JS output profiles. |
| `evaluation.compound-assignment` | supported / P0 | Identifier/property/element targets preserve receiver, key, prior-value, and RHS order. Other lvalues are outside the contract. |
| `loops.for-continue-step` | supported / P0 | Lowered `for` loops execute their increment before continuing; labeled continue is unsupported. |
| `switch.fallthrough` | supported / P0 | A normalized state machine preserves case search, default placement, fallthrough, and break. |
| `switch.continue` | unsupported / U | Continue from a switch to an enclosing loop is rejected. |
| `exceptions.try-catch` | supported / P0 | Ordinary catch and propagation are exercised. |
| `exceptions.finally` | helper / J1 | Ordering/propagation is preserved when completion remains inside the modeled region. |
| `exceptions.finally-outer-transfer` | unsupported / U | Return, break, or continue crossing the protected region is rejected. |
| `this.class-and-lexical-arrow` | supported / P0 | Supported class methods and lexical arrows preserve their receiver/capture behavior. |
| `prototypes.dynamic-mutation` | unsupported / U | Prototype mutation requires an explicit boundary/refactor. |
| `async.await` | helper / J1 | Uses `genes.js.Async` and the JavaScript Promise/microtask contract. |
| `modules.esm-bindings` | supported / J1 | Covers the exercised ESM value/type binding and re-export subset. |
| `modules.side-effect-import` | unsupported / U | Bare side-effect imports are rejected because no Haxe initialization edge exists. |

The semantic harness currently requires exactly the 14 supported rows to occur
and the 4 unsupported rows to fail with feature-specific diagnostics. This
table does not turn other syntax accepted by snapshots into semantic evidence.

## Project and file inventory

- ts2hx translates the sorted root files returned for the supplied tsconfig.
  Use `--list-files` and ensure every implementation dependency intended for
  conversion is present.
- `.ts`, `.tsx`, `.js`, and `.jsx` are accepted translation file kinds. JS/JSX
  must be enabled and included by the source tsconfig.
- `.d.ts` files receive a `declaration-only` disposition and emit no Haxe.
  Declaration ingestion belongs to dts2hx or handwritten externs.
- Other file extensions fail with `TS2HX-FILE-KIND-001`.
- Comments, original formatting, and TypeScript source maps are not preserved as
  a source-to-source fidelity contract. Diagnostics retain source spans and
  syntax kinds in the manifest.
- Without `--clean`, the transactional writer overlays planned files on a copy
  of the prior directory, so obsolete files can remain. Use a dedicated output
  directory plus `--clean` for reproducible migration builds.

## Top-level execution and module initialization

Haxe has no direct general equivalent for arbitrary executable TypeScript
module statements. Current output supports/imports declarations, typed module
aliases, and a bounded export subset, but rejects unknown top-level statements
instead of omitting them.

Important consequences:

- authored `main()` calls in five snapshot fixture `index.ts` files are
  deliberately assisted losses;
- the three roundtrip fixtures invoke the translated Haxe `Main` explicitly;
- bare side-effect imports fail strict mode;
- uninitialized top-level variables and top-level destructuring declarations
  are unsupported;
- async function-valued top-level variables are unsupported; use an async
  function declaration in the supported subset;
- add a reviewed Haxe bootstrap outside generated output rather than assuming a
  TypeScript entry module was preserved.

## Types and declarations

TypeScript's type system is larger than Haxe's. Current fixtures exercise type
aliases, object-literal types, optional fields, function types, interfaces,
classes, enums, qualified names, selected unions, React aliases, and generic
surfaces. These are useful coverage, not an exhaustive type-equivalence model.

Known boundaries include:

- overload resolution, declaration/namespace merging, conditional/mapped
  types, and complex type/value namespace identities have no blanket contract;
- local class type+value aliasing may be approximated with a thin subclass
  because Haxe cannot emit a type alias and value alias with the same name;
- import classification still uses bounded symbol/name rules for some shapes;
- non-relative package externs may need manual refinement for precise values,
  constructors, overloads, and package export forms;
- generated strong-type guards cover selected roundtrip/React user modules,
  not every possible translated extern boundary;
- a successful Haxe compile does not prove the public API matches the original
  TypeScript declarations.

For normal npm declaration ingestion, use dts2hx and the genes-ts package-shape
fixtures rather than expanding ts2hx into a second `.d.ts` converter.

## Expressions and evaluation order

The emitter supports a substantial expression subset, including object/array
literals, calls/construction, property and element access, optional chaining,
selected nullish/logical expressions, ternaries, assignments, updates,
destructuring helpers, spreads, regex handling, and JSX intent.

Only behaviors represented in the semantic matrix have exact three-runtime
evidence. In particular:

- unary plus uses the named JS-semantic `genes.js.Coercion` helper and retains
  native empty/whitespace/invalid-string behavior;
- unsupported compound-assignment lvalues fail instead of duplicating receiver
  or key side effects;
- JavaScript truthiness and strict equality are JS-specific helper contracts;
- `undefined`, omitted parameters, explicit `null`, and uninitialized values
  remain distinct where the supported source type exposes that distinction;
- syntax that falls through the direct expression printer without a modeled
  form must fail the containing construct in strict mode.

## Control flow and exceptions

Snapshots exercise conditionals, loops, switch, break/continue, try/catch, and
finally. Exact differentials own only the matrix rows above.

- labeled control transfer is not generally supported;
- switch fallthrough is modeled, but switch-to-enclosing-loop `continue` is
  rejected;
- `finally` cannot yet carry a return/break/continue completion across an outer
  function or loop boundary;
- unsupported statement kinds receive a source-positioned diagnostic rather
  than a placeholder that returns success.

## Classes, `this`, and prototypes

The supported class subset covers constructors, fields, methods, static
members, inheritance shapes represented by fixtures, method `this`, and
lexical arrow capture. It does not promise general JavaScript object-model
fidelity.

- dynamic prototype writes are rejected;
- arbitrary prototype chains, monkey-patching, property descriptors, proxies,
  bound/unbound method extraction, and every static-inheritance corner are not
  covered unless a focused fixture says otherwise;
- `instanceof` and constructor identity across complex module re-exports need
  explicit differential evidence.

## Async and Promise behavior

Async declarations and awaits lower through the genes async macro/runtime for
the JS target. The semantic trace exercises selected resolution/rejection and
ordering behavior, but the surface remains bounded.

- top-level async function-valued variables are rejected;
- arbitrary thenables, cancellation, every nested `finally` completion, and
  host scheduling differences are not broadly certified;
- current output is J1 and assumes JavaScript Promise/microtask semantics;
- another Haxe target requires a new async abstraction and cross-target tests.

## TSX and React

TSX lowering emits target-neutral genes JSX marker calls for intrinsic tags,
components, fragments, ordered props, spreads, and supported child
expressions. Current evidence is deliberately narrower than the todoapp's
Haxe-authored JSX coverage:

- `basic-tsx` and `react-types` are snapshotted and Haxe compile-smoked;
- their direct standard-Haxe JS smoke is not executed because marker calls are
  compiler intent, not a standalone runtime API;
- `react-types` additionally roundtrips through genes-ts to strict TSX and has
  a strong generated-user-module check;
- there is no current original-React versus translated-React render
  differential for arbitrary TSX;
- hooks, refs, generic components, JSX namespace augmentation, spread conflict
  rules, every child type, and runtime-specific JSX factories require focused
  fixtures before support is claimed.

Use assisted mode for an inventory when a TSX project exceeds this subset; do
not infer React migration readiness from generated Haxe syntax alone.

## Imports, packages, and host APIs

Relative ESM bindings and re-exports have bounded fixture coverage. A
non-relative import generates a small `<basePackage>.extern.*` module using
`@:jsRequire`-style JS interop.

- the `non-relative-imports` fixture is compile-smoked but not Node-executed;
  the standard Haxe JS output uses `require()` while the tool package is ESM;
- CommonJS `export =`, conditional package exports, subpath conditions,
  namespace merging, and complex type/value exports are not a general ts2hx
  runtime contract;
- Node/browser globals and npm packages keep translated code in the JS-specific
  adapter layer;
- bare side-effect imports are rejected;
- a compile-only extern is not evidence that runtime module identity or loading
  order is correct.

## Portability

`strict-portable` is not a current CLI mode. Current grades help identify work;
they do not prove another Haxe backend.

- P0 means the exercised emitted shape is ordinary Haxe, not that every target
  has executed it;
- P1 is a future review grade, not a current automatic promotion;
- J1 requires JavaScript helpers/externs or host semantics;
- A and U carry no executable portability claim.

Follow [`PORTABILITY.md`](PORTABILITY.md) to isolate adapters and construct a
new target differential before claiming portability.

## Current fixture evidence

The registered snapshot suite covers 20 projects and currently compares 48
generated files. Most compile and run through standard Haxe JS. Exceptions are
explicit:

- `basic-tsx` and `react-types`: compile-only under standard Haxe JS;
- `non-relative-imports`: compile-only because of the ESM/`require()` boundary;
- five fixtures use assisted snapshots for one acknowledged top-level
  `index.ts` call;
- only `roundtrip-fixture`, `roundtrip-advanced`, and `module-regexp` belong to
  the roundtrip runtime smoke;
- exact semantics live in `semantic-diff`; known losses live in
  `semantic-unsupported`; output transactionality lives in
  `unsupported-top-level`.

The authoritative current list and per-fixture flags are in
`tools/ts2hx/src/test-snapshots.ts`. [`USAGE.md`](USAGE.md) lists every fixture
by name and the commands that own it.

## Adding support safely

When a real project finds a gap:

1. reduce it to the TypeScript/JavaScript language or module construct;
2. decide whether it is supportable, JS-helper-specific, or unsupported;
3. add a stable feature/diagnostic ID and source provenance when semantics are
   at risk;
4. normalize control flow/evaluation order before the Haxe printer;
5. add original TS versus classic and genes-ts runtime traces;
6. keep assisted output explicit until strict evidence is green;
7. run `yarn --cwd tools/ts2hx test` and `yarn test:ci`.

Do not add downstream project names or product-specific schema behavior to the
translator. Every improvement should benefit an arbitrary TypeScript project
using the same construct.
