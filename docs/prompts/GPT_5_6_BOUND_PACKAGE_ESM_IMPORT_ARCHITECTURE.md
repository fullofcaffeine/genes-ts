# GPT-5.6 Pro review: strongly typed bound-package ESM imports

Use this prompt with GPT-5.6 Pro after uploading the focused Repomix XML
listed at the end. This is a narrow compiler architecture review. Do not turn
the existing package-request diagnostic into support until both the runtime
request and the imported value types have a mechanically explicit owner.

---

You are reviewing a real TypeScript-to-Haxe migration tool inside a
Haxe-to-TypeScript/JavaScript compiler. Work evidence-first from the uploaded
repository files. Label important claims as **observed**, **inference**, or
**experiment required**. Cite uploaded paths and line ranges. If the supplied
files cannot establish a TypeScript, Haxe, Node ESM, or package-resolution
fact, name the smallest fixture and command that would establish it.

## Decision requested

Design the smallest strongly typed lowering that lets ts2hx preserve bound ESM
package imports such as:

```ts
import greet, { add as sum, PI } from "fakepkg";
import * as Pkg from "fakepkg";

export function main(): string {
  return `${greet("world")}:${sum(1, 2)}:${Pkg.add(3, 4)}:${PI}`;
}
```

The generated Haxe must retain the literal runtime package request in source
request order, use TypeScript's real resolved declaration types, compile
through classic Genes and genes-ts, and avoid `Dynamic`, `untyped`, unchecked
casts, generated user-module `any`/broad `unknown`, or raw emitted import/type
strings used as a substitute for Haxe typing.

A narrow first subset is preferred. It is acceptable to support only immutable
package exports with signatures that have a strong Haxe representation and to
fail closed for overloads, classes, callable objects, mutable exports, or
transitive types until their own fixtures prove them.

The review baseline is commit
`44bb0b39f068b0df990eaca571fc7b131c79e467`. Bead `genes-dxw` owns the work.
The uploaded tree may additionally contain this prompt and updated Bead export;
those do not change compiler behavior.

## Why this review exists

ts2hx already plans effective ESM requests from TypeScript's configured emit.
It preserves ordered acyclic converted imports, bare package requests, and
manifest-owned external resources. A non-relative request with runtime
bindings still fails with
`TS2HX-MODULES-ESM-RUNTIME-PACKAGE-BOUND-001`.

There is a tempting one-line change: send every non-relative request through
the existing external request carrier and let ordinary `@:jsRequire` value
references attach bindings to that first request slot. A local hand-authored
spike shows that the shared Genes dependency projection can do exactly that.
However, production ts2hx currently generates every package extern value as
`Dynamic`. Removing only the request diagnostic would therefore claim support
while losing the source package's type contract.

This review must decide the type boundary and runtime request together. Do not
optimize for reducing the final unsupported-row count.

## Current implementation facts to verify

- `buildProjectRuntimeImportPlan` uses the final TypeScript transform inventory
  as the authority for whether an import creates an ESM runtime request. It
  rejects configured CommonJS output, converted cycles, attributes outside the
  supported model, live converted bindings, runtime re-exports, and bound
  package requests before any output is published.
- For a bare package request, the plan emits an external compiler request with
  the original literal specifier. Generated Haxe stores it in a kept,
  compiler-internal carrier and calls
  `genes.internal.EsmRequestFact.external(specifier, attribute)`.
- The Genes planner models binding-free external requests separately from
  imported bindings. `DependencyPlan.projectImplementation` coalesces equal
  `(external, path, attribute)` identities at first occurrence and attaches a
  later bound value import to that slot.
- `buildExternModules` collects non-relative import names and namespace member
  reads. `emitExternModuleFile` emits one `@:jsRequire(specifier)` extern class,
  but its default and named fields are all `Dynamic`.
- The source emitter rewrites default, named, aliased, and namespace references
  to static members of that generated extern class. It does not currently ask
  the TypeChecker for each external symbol's callable/value/type surface.
- The existing `emitType` function accepts TypeScript syntax nodes and returns
  `Dynamic` for omitted, `any`, `unknown`, and unhandled shapes. That fallback
  is useful for assisted scaffolding but is not a sound support gate for
  imported package values.
- The `non-relative-imports` snapshot has a local ESM `fakepkg` with an
  `index.d.ts`, but the fixture is assisted and compile-only. Its snapshot
  visibly contains `Dynamic` extern fields and the package-bound diagnostic.
- dts2hx is a declaration-ingestion tool, but the repository's Haxe-bootstrap
  feasibility experiment found that wholesale generation against the
  TypeScript package produced 1,241 Haxe files, 30,281 lines, 34 reported
  unhandled-symbol errors, and 1,658 `Dynamic` occurrences. Do not assume that
  invoking dts2hx automatically creates the narrow strong boundary required
  here.
- Standard Haxe remains an explicit capability failure for every effective ESM
  request. Bound package support, if adopted, is J1 through both Genes profiles;
  it does not create a new standard-Haxe request path.

Correct any claim that the uploaded files disprove.

## Local evidence spike completed during scoping

The temporary spike source is not part of the upload. Treat these results as
observed experiment evidence, not as a production design.

With Haxe 4.3.7, Node 20.19.3, TypeScript 5.5/6/7 checking, `-dce full`, and the
review baseline:

1. A hand-authored Haxe extern declared:

   ```haxe
   @:jsRequire("fakepkg")
   extern class Fakepkg {
     @:native("default") static function greet(name:String):String;
     static function add(left:Float, right:Float):Float;
     static var PI(default, never):Float;
   }
   ```

2. A kept compiler-internal field called
   `EsmRequestFact.external("fakepkg", null)` before code referenced those
   extern members.
3. Classic Genes and genes-ts each emitted exactly one declaration:

   ```ts
   import * as Fakepkg from "fakepkg"
   ```

   followed by typed `Fakepkg["default"]`, `Fakepkg.add`, and `Fakepkg.PI`
   reads. Neither emitted a redundant bare request or a marker/carrier.
4. Both generated profiles ran the local ESM package and printed:

   ```text
   Hello world
   3
   3.14
   ```

5. The genes-ts output passed strict TypeScript 5.5, 6, and 7 checks.

This proves that one strong hand-authored extern plus the existing external
request carrier is sufficient for this reduced runtime shape. It does **not**
prove that ts2hx can derive that extern safely, that namespace coalescing is
correct for mutable/getter/proxy exports, or that broader declaration shapes
have faithful Haxe representations.

### Shadow TypeChecker evidence added after the runtime spike

The repository now also contains an evidence-only test at
`tools/ts2hx/src/test-package-extern-facts.ts`. It emits no Haxe and does not
change the package diagnostic. Against the local declaration file, the pinned
TypeScript Program API established these additional facts:

- a default import's local alias resolves to the declared function symbol
  `greet`, while the runtime export name remains `default`;
- `add as sum` resolves the local name `sum` to runtime export `add`;
- a namespace alias resolves to equivalent module facts, but not necessarily
  the same JavaScript `ts.Symbol` object instance as the module specifier;
- `getExportsOfModule` returns the default export as an alias whose direct flags
  do not include `Value`; value/type classification is wrong unless the alias
  is resolved first;
- checker `typeToTypeNode` renders the monomorphic functions as `FunctionType`
  nodes and `PI` as `NumberKeyword`; declaration-list flags separately prove
  that `PI` is `const`;
- a mutable `let` export has the same `NumberKeyword` type node as the constant,
  so type shape alone cannot establish live-binding safety;
- an overloaded function becomes a `TypeLiteral` containing two call
  signatures, while a function returning a package interface becomes a
  `FunctionType` whose return text is the unresolved named `Result` type; and
- the `Result` interface is a type-only module export. Materializing the
  function type does not by itself create the companion Haxe declaration.

Run this shadow contract with:

```bash
yarn --cwd tools/ts2hx test:package-extern-facts
```

These facts narrow the design but are not a recommendation to build a type
converter inside `emitExternModuleFile`.

### Reduced dts2hx experiment added after the checker probe

A second evidence-only experiment tested Candidate 4 against the same local
`fakepkg` entrypoint with the repository-pinned dts2hx 0.34.0 / TypeScript
5.9.3 toolchain.

The first invocation reused the fixture's ordinary consumer `tsconfig`, which
includes Node types. Even with `--skipDependencies --modular --noLibWrap`,
dts2hx generated 1,997 Haxe files and 196,100 lines, printed many unrelated
standard-library unhandled-symbol diagnostics, and contained 4,592
`Dynamic`/`Any` lines. This confirms that a normal consumer configuration is
not a deterministic narrow declaration boundary.

The same package was then converted with an isolated declaration config:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "types": [],
    "lib": ["ES2022"],
    "skipLibCheck": false
  }
}
```

That invocation produced exactly two files and no warning/error or weak-type
token: a nine-line `Fakepkg.hx` and a four-line `fakepkg/Result.hx`. The value
module contained strong signatures for the default function, `add`, `PI`, both
`overloaded` call shapes, `parseResult`, and the mutable export. The referenced
`Result` interface became a real Haxe record typedef.

The exact generated externs were consumed unchanged by a hand-authored Haxe
runtime probe. Classic Genes and genes-ts each emitted one
`import * as Fakepkg from "fakepkg"`; default, named, overload, constant, and
record-result reads produced this transcript in both profiles:

```text
Hello world
3
3.14
4
typed
```

The genes-ts tree passed strict TypeScript 5.5, 6, and 7. This proves that
dts2hx can represent more than the proposed primitive-only subset for one
isolated declaration entrypoint. It does **not** prove that ts2hx should invoke
it automatically:

- the production transaction would need to own a sanitized declaration
  configuration rather than inherit ambient consumer types;
- the generated class exposes `export let mutableValue` as writable
  `static var`, which is not a safe authoring model for an imported ESM binding;
- dts2hx names the default field `default_`, while current ts2hx rewrites it to
  `__default`;
- wholesale output contains declarations that the source never imports, so
  selection, DCE/public-surface ownership, hashes, and stale-file cleanup still
  require an immutable plan; and
- dts2hx owns a different pinned TypeScript API version. Production integration
  must compare stable declaration identities rather than share compiler AST
  objects.

The review should therefore distinguish "dts2hx can spell this reduced extern"
from "dts2hx is a sound transactional package-import subsystem."

## Candidate directions to evaluate

These are hypotheses, not instructions. Adopt, reject, or combine them.

### Candidate 1: checker-derived per-symbol extern synthesis

For each effective package binding, resolve the import alias through the
TypeChecker, inspect the target symbol/declarations/call signatures, and emit a
minimal extern member. Use a checker-produced `TypeNode` only if the existing
Haxe type renderer can represent it without falling back to `Dynamic`.

Evaluate how to handle default exports, aliases, namespace member reads,
functions, immutable constants, optional/rest parameters, generic signatures,
overloads, object types, referenced package types, classes, enums, and
value/type namespace merging. Specify a deterministic fail-closed predicate,
not a best-effort renderer.

### Candidate 2: a dedicated typed package-import plan

Add immutable semantic records before Haxe printing, for example one record per
runtime package request and one per local binding/member. The plan would own the
resolved TypeScript symbol, export mutability, supported Haxe type, runtime
field spelling, source provenance, and the request identity to which it must
attach. `buildExternModules` would print only a validated plan.

Evaluate whether this is the smallest sound seam or unnecessary duplication of
existing `collectImports`, effective-request, and TypeChecker facts.

### Candidate 3: require user-supplied typed Haxe extern mappings

Keep automatic bound packages unsupported unless a project manifest maps the
literal package specifier and imported names to reviewed Haxe extern types.
ts2hx would own request order and identifier rewrites but not declaration
translation.

Evaluate ergonomics, deterministic validation, manifest identity, source-map
ownership, package-version drift, default/namespace shapes, and whether this
merely moves migration work onto every user.

### Candidate 4: dts2hx-backed package declarations

Run or reuse dts2hx for the resolved package entrypoint, then bind source
imports to generated declarations. Evaluate transactionality, reproducibility,
version ownership, output size, weak fallback rejection, conditional exports,
duplicate generators, and how ts2hx proves that the generated extern's runtime
specifier is the original package request.

Do not recommend this solely because dts2hx already exists; account for the
measured broad/weak output from the feasibility experiment.

### Candidate 5: narrow auto subset plus explicit manifest escape hatch

Automatically support only mechanically strong signatures such as monomorphic
functions over mapped primitives/nullish values and immutable primitive
constants. Require a typed extern mapping for everything else. Retain one
stable package-bound diagnostic with reason-specific detail for excluded
shapes.

Evaluate whether this gives a useful first increment without making the
support row or documentation sound broader than its evidence.

### Candidate 6: retain fail-closed status

If TypeScript package declarations cannot be projected into strong Haxe
without building a second declaration converter or exposing misleading types,
recommend keeping the current diagnostic. Explain what exact future artifact
would change that decision.

## Questions the decision must resolve

1. What immutable records should own a package request, local import binding,
   resolved export symbol, declaration/call signature, mutability, supported
   Haxe type, runtime field spelling, and original provenance?
2. Which TypeScript API operation is authoritative for default/named/aliased
   imports and namespace member reads? How are alias symbols resolved without
   losing the runtime export name?
3. What exact first type subset can be rendered with no `Dynamic`, `untyped`,
   cast, generated `any`, or fabricated default? State deterministic rejection
   rules for every other shape.
4. Should functions be emitted as Haxe extern methods rather than function-
   typed variables? How are optional/rest parameters, `this` parameters,
   overloads, generic parameters, and async returns handled or rejected?
5. How are immutable values distinguished from `let`/mutable/live exports,
   accessors, getters, proxies, CommonJS property snapshots, and declarations
   whose runtime mutability is not knowable from `.d.ts` alone?
6. Can namespace imports safely lower to one static extern class when only a
   statically known immutable member subset is used? What must fail for computed
   keys, enumeration, spreading, identity comparison, or passing the namespace
   as a value?
7. How are transitive named types represented in ordinary Haxe? Is a
   `@:ts.type("import('pkg').T")` override ever sufficient when classic Genes
   still needs a real Haxe type, or must ts2hx generate/require a companion
   extern declaration?
8. How does the external request marker coalesce with the `@:jsRequire`
   binding at the first source request slot? What exact generated declaration
   should default, named, mixed, and namespace source imports become?
9. Is one namespace import an acceptable projection for multiple source
   declarations of the same package under the immutable subset? Include
   duplicate evaluation, getter observation, and binding identity in the
   argument.
10. How are package `exports`, `types`, conditional resolution, subpath
    specifiers, ESM/CommonJS format, and runtime staging validated without
    executing package code during translation?
11. Which compiler-internal files own diagnostics and transaction validation,
    and how does assisted output avoid implying that a weak package scaffold is
    executable?
12. Which semantic row and canonical failure variant change after the first
    increment? Do not remove the package-bound failure until every advertised
    shape has executable evidence.
13. What source-map and declaration behavior is required for generated extern
    files, which have no direct authored Haxe source position?
14. Can all changes remain inside ts2hx package planning/extern synthesis plus
    existing shared Genes request facts, or does the hand-authored spike expose
    a missing generic Genes feature?

## Required semantic examples

The answer must trace these through TypeScript resolution, planned Haxe,
classic Genes, genes-ts, and runtime execution. It may keep a row fail-closed,
but must say why and give the exact diagnostic owner.

### A. Default plus named alias

```ts
import greet, { add as sum } from "fakepkg";
export function run(): string {
  return `${greet("Ada")}:${sum(1, 2)}`;
}
```

### B. Namespace member subset

```ts
import * as Pkg from "fakepkg";
export function run(): number {
  return Pkg.add(Pkg.PI, 1);
}
```

### C. Duplicate declarations and unused retained request

```ts
import greet from "fakepkg";
import { add } from "fakepkg";
import { unused } from "effectful-package";
export const result = greet(String(add(1, 2)));
```

The configured TypeScript emit determines whether `unused` remains. If it
does, package initialization must still occur in the original request order.

### D. Mutable export

```ts
import { value } from "mutable-package";
export function read(): number { return value; }
```

The package exports `let value` and mutates it later. Explain whether this
continues to use `TS2HX-MODULES-ESM-BINDINGS-LIVE-001`.

### E. Overload and transitive package type

```ts
import { parse, type Result } from "typed-package";
export function run(input: string): Result {
  return parse(input);
}
```

`parse` has overloads and `Result` is a named exported object type. Do not
silently collapse this to one signature or `Dynamic`.

### F. Namespace as a value

```ts
import * as Pkg from "fakepkg";
export function run(): object { return Pkg; }
```

Static member rewriting alone does not represent namespace identity. Define
the first-increment disposition.

### G. Conditional or CommonJS package

Use a package whose type entrypoint resolves but configured NodeNext emit or
runtime conditions select CommonJS. Explain which compiler fact prevents an
ESM support claim.

## Non-negotiable repository rules

1. genes-ts remains a general-purpose Haxe-to-TypeScript/JavaScript compiler.
   No downstream package names, schemas, DTOs, or application behavior enter
   compiler code.
2. TypeScript's Program/TypeChecker and typed Haxe AST remain authoritative.
   Do not replace TypeScript resolution or build a universal IR.
3. Classic Genes and genes-ts are first-class output profiles and consume the
   same semantic request facts.
4. No `untyped`, `Dynamic`, emitted user-module `any`, broad `unknown`,
   unchecked casts, raw target import strings, or process-global registries.
5. A generated extern is a compiler boundary, not permission to erase a type
   the TypeScript checker already knows. Unsupported types fail closed.
6. Effective runtime requests come from configured TypeScript emit, not source
   syntax guesses. Non-ESM output remains unsupported for this feature.
7. Package code must not execute during translation. Resolution and declaration
   inspection must be deterministic and side-effect free.
8. Preserve exact request order, once-only module evaluation, alias identity,
   DCE retention, and transactional output. Do not add redundant bare imports.
9. Standard Haxe remains target-guarded for effective requests; do not claim a
   new portable runtime path.
10. Advanced Haxe externs, abstracts, metadata, generic types, and JS interop
    need friendly Why/What/How hxdoc that explains typing and codegen pitfalls.
11. Unsupported input remains source-positioned, deterministic, transactional,
    and explicit in assisted manifests.
12. Land incrementally with rollback points, focused three-runtime
    differentials, pinned TS/Haxe lanes, then full `yarn test:ci`.
13. Every non-trivial commit body explains old behavior, new behavior,
    verification, and intentionally deferred scope in beginner-readable terms.

## Required answer

Return a decision document with these sections:

1. **Verdict and exact first boundary** — adopt/reject/modify every candidate;
   distinguish current support, first increment, and later scope.
2. **Semantic model** — immutable TypeScript records for requests, bindings,
   symbols, type plans, mutability, Haxe spelling, and provenance. Include
   concise typed TypeScript pseudocode.
3. **Type extraction contract** — exact TypeChecker operations, alias/default
   resolution, supported type/signature predicate, deterministic diagnostics,
   and handling of transitive package types.
4. **Generated Haxe extern contract** — exact module/member shapes for default,
   named, alias, namespace, functions, constants, nullish values, and every
   retained advanced annotation. Include concise Haxe pseudocode and required
   Why/What/How docs.
5. **Request-order integration** — prove how external request facts and
   `@:jsRequire` value edges coalesce at first occurrence in both Genes modes;
   identify any generic Genes change actually required.
6. **Proof for examples A-G** — trace resolution, generated Haxe/imports,
   typing, DCE, runtime order, and failure behavior.
7. **Failure modes and threat model** — include weak type leakage, wrong alias
   symbol, overload collapse, namespace identity, mutable/live bindings,
   getter/proxy observation, ESM/CJS interop, package conditions, unused
   requests, duplicates, DCE, source maps, declarations, transactionality,
   package-code execution, and compile-server state.
8. **Incremental implementation plan** — reversible commits/Beads, shadow
   checks, rollback points, and smallest production file changes.
9. **Test matrix** — local network-free packages; original TypeScript, classic
   Genes, genes-ts; `-dce full`; strict TS 5/6/7; exact import source; default,
   named, aliases, mixed, namespace, duplicate/unused, mutability, overload,
   transitive types, CommonJS, assisted/strict transactions, deterministic
   trees, no weak types, and full CI.
10. **Exact semantic/docs/compatibility changes** — feature grade, canonical
    failure inventory, counts, fixture ownership, limitations/usage wording,
    compatibility report evidence, and output budgets. Do not guess measured
    byte budgets.
11. **Open experiments** — only unproved facts, each with the smallest fixture
    and exact repository command that resolves it.

Do not return a generic essay about TypeScript declaration files. Prefer a
narrow, strongly typed boundary with explicit reasons to reject wider package
shapes. If automatic synthesis is not smaller or safer than a typed manifest,
say so plainly.

## Focused files to upload

Upload a companion Repomix XML containing at least:

- `AGENTS.md`, `package.json`, `haxelib.json`, `config/toolchains.json`;
- this prompt and the earlier bound-request architecture prompt/response;
- `tools/ts2hx/src/haxe/emit.ts`, especially import collection, `emitType`,
  package extern generation, request planning, source emission, and project
  transaction sections;
- `tools/ts2hx/src/semantic/ir.ts`, `project.ts`, `typescript-api.ts`, and the
  effective-request semantic owner;
- `tools/ts2hx/src/test-semantic-diff.ts`, `test-snapshots.ts`,
  `test-strict-diagnostics.ts`, `test-effective-module-requests.ts`, and the
  evidence-only `test-package-extern-facts.ts`;
- the complete `non-relative-imports`, `semantic-diff`, and relevant
  `semantic-unsupported` package/binding fixtures and reviewed snapshots;
- `src/genes/DependencyPlan.hx`, `DependencyPlanBuilder.hx`, `Dependencies.hx`,
  `CompilerInternal.hx`, and `internal/EsmRequestFact.hx`;
- both Genes implementation import printers and the compiler-internal/public
  projection owners;
- `docs/ARCHITECTURE.md`, `ARCHITECTURE_ROADMAP.md`, `OUTPUT_MODES.md`,
  `TOOLCHAINS.md`, and `COMPATIBILITY_REPORT.{md,json}`;
- `docs/ts2hx/LIMITATIONS.md`, `PORTABILITY.md`, `USAGE.md`, and the Haxe
  bootstrap feasibility decision;
- `tests/compatibility/evidence.json` and output/profile ownership manifests.

Do not include `node_modules` except the two tiny fixture-local fake packages;
do not include generated build trees, `.tmp`, unrelated archives, secrets, or
machine-local paths.

---
