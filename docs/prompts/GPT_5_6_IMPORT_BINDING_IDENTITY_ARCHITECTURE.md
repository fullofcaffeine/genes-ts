# GPT-5.6 Pro review: canonical ESM binding identity across Haxe declarations

Use this prompt with GPT-5.6 Pro after uploading the focused Repomix XML
listed at the end. This is a narrow compiler-identity review. Do not change the
shared dependency model until request identity, export binding identity, Haxe
declaration identity, and emitted local-name identity are mechanically separate.

---

You are reviewing a real Haxe-to-TypeScript/JavaScript compiler. Work
evidence-first from the uploaded repository files. Label important claims as
**observed**, **inference**, or **experiment required**. Cite uploaded paths and
line ranges. If a Haxe, TypeScript, or ECMAScript fact is not established by the
files or the supplied executable transcript, name the smallest fixture and
command that would establish it.

## Decision requested

Define the smallest canonical identity model that prevents two distinct ESM
bindings from collapsing when their JavaScript module specifier and simple
Haxe name match.

The decision must say exactly:

1. where a canonical binding ID is created from compiler-owned Haxe facts;
2. which fields identify a module request, an exported binding, a Haxe
   declaration, and an allocated local name;
3. which equality relation is used for request coalescing, binding
   de-duplication, alias allocation, runtime-versus-type-only ownership, and
   expression/type accessor lookup;
4. how host/compiler-created imports with no `ModuleType` receive a stable
   identity; and
5. how classic Genes JS, genes-ts TypeScript, and classic `.d.ts` consume the
   same facts without a universal backend IR or printer-local reconstruction.

The production baseline is
`8f263d9a1fc1f339baf607811711b102a188a91c`. The uploaded tree additionally
contains this prompt and the evidence-only `probe:binding-identity` fixture.
Those additions do not change production compiler behavior and the probe is
deliberately not a release gate until the architecture is reviewed. Bead
`genes-ntz` owns the work.

## Why this review exists

Genes already separates an ESM **module request** from its imported bindings.
That distinction is important: two imports from the same module ask the loader
to evaluate one module, even when they bind different exports. The ordered
request plan and both printers should be preserved.

The remaining model still collapses some **bindings** too aggressively. A
package may legally export both a default value and a named value called `Foo`.
Haxe can describe those values with two extern classes that are both named
`Foo`, as long as their full Haxe packages differ:

```haxe
package package_shapes.default_binding;

@:jsRequire("genes-binding-identity-fixture", "default")
extern class Foo {
  public function new();
  public function marker():String;
}
```

```haxe
package package_shapes.named_binding;

@:jsRequire("genes-binding-identity-fixture", "Foo")
extern class Foo {
  public function new();
  public function marker():String;
}
```

The full Haxe declarations are distinct and their `@:jsRequire` forms name
different JavaScript exports. Current dependency de-duplication sees only the
external module path, simple name, alias, and attribute. It keeps the first
binding and makes both typed Haxe declarations resolve through that local.
This silently changes runtime behavior while TypeScript remains structurally
happy.

This is the last release-blocking finding from the post-roadmap audit. A local
patch that merely adds `DependencyType` to one equality check is not enough:
the accessor currently loses Haxe declaration identity too, and the same facts
are projected independently for runtime, TypeScript-only, and declaration-only
uses. Conversely, including declaration identity in every equality may
over-split two Haxe declarations that intentionally refer to the same runtime
export. The review must choose the exact layers before implementation.

## Executable reproduction

The upload contains:

- `tests/genes-ts/package-shapes/src/package_shapes/BindingIdentityProbe.hx`;
- the two `Foo.hx` extern declarations;
- `packages/genes-binding-identity-fixture`, whose default and named values
  return different markers;
- paired TS/classic HXML files; and
- `scripts/probe-binding-identity.ts` plus the manual command below.

Run with the pinned Node 20 and Haxe 4.3.7 environment:

```bash
yarn probe:binding-identity
```

The command builds and executes the same Haxe source through both first-class
Genes profiles, prints their import lines and transcripts, then asserts the
correct JavaScript result. The reviewed baseline produces:

```json
{
  "tsImports": [
    "import Foo from \"genes-binding-identity-fixture\"",
    "import {Register} from \"../genes/Register.js\""
  ],
  "classicImports": [
    "import Foo from \"genes-binding-identity-fixture\"",
    "import {Register} from \"../genes/Register.js\""
  ],
  "tsTranscript": {
    "defaultBinding": "default",
    "namedBinding": "default"
  },
  "classicTranscript": {
    "defaultBinding": "default",
    "namedBinding": "default"
  }
}
```

The expected result is:

```json
{
  "defaultBinding": "default",
  "namedBinding": "named"
}
```

**Observed.** Both implementation profiles emit only a default import and both
constructor calls use that one local. genes-ts also gives both public fields
the same imported type name, and classic `.d.ts` does likewise. TypeScript
5.5, 6, and 7 accept the generated source because the two fixture classes have
compatible structure. Only runtime markers reveal that the named export was
lost.

**Observed.** The ordinary `yarn test:interop:module-shapes` gate remains green
because its existing packages do not combine the same specifier and same
simple Haxe name with different import forms. The probe is isolated so the
repository can carry a stable review reduction without making main CI red.

## Current implementation facts to verify

1. `DependencyType` already distinguishes `DName`, `DDefault`, and
   `DAsterisk`, but the mutable `Dependency` record has no declaration ID.
   (`src/genes/Dependencies.hx`)
2. `Dependencies.makeDependency(base)` correctly reads each extern's own
   `@:jsRequire` metadata. It produces `DDefault/Foo/pkg` for the first fixture
   declaration and `DName/Foo/pkg` for the second.
3. `DependencyRequest` already retains the compiler-owned `ModuleType` while
   the semantic graph is built. `DependencyEdge.referencedType` also retains
   that declaration for reachability and diagnostics.
4. `Dependencies.pushAndGet` builds its alias key from external/internal owner,
   module path, and `dependency.name`. Its duplicate test compares external,
   name, alias, and import attribute, but not import form or declaration.
5. `DependencyPlan.projectImplementation.sameBinding` compares external, path,
   name, alias, and attribute, but not import form or declaration.
6. `DependencyModuleRequest.equals` intentionally compares only external/path/
   attribute. That is correct loader-request identity and should not become a
   binding or Haxe-declaration key.
7. `TypeAccessor.fromBaseType` reduces the typed declaration to
   `Concrete(dependency.path, dependency.name, native)`. The original
   declaration and import form are no longer present.
8. `Dependencies.typeAccessor` scans one path bucket and returns the first
   dependency whose name or alias matches. It therefore cannot distinguish the
   two `Foo` declarations after they reach the accessor.
9. Both implementation printers already spell default, namespace, and named
   imports differently when distinct dependencies survive. They can emit more
   than one declaration for a single request plan. The defect is not a missing
   syntax form in either printer.
10. Classic declaration emission uses a separate `DeclarationOnly` projection
    and then the same accessor lookup pattern. Type-only and runtime bindings
    need one consistent identity even though a runtime edge must win over an
    otherwise duplicate type-only edge.
11. Some imports have no Haxe declaration: JSX capability imports,
    module-field `@:jsRequire`, expression-field requires, and external helper
    edges can enter the plan with `referencedType == null`. A design that
    requires every binding to contain a `ModuleType` is incomplete.
12. Some Haxe declarations intentionally share one runtime binding: secondary
    externs may inherit the primary module owner's `@:jsRequire`, explicit
    aliases may give one export a Haxe-friendly local, and dotted native/export
    paths have compatibility handling. Declaration identity and export binding
    identity therefore cannot be assumed to be identical relations.

Correct any claim that the uploaded files disprove.

## Identity layers the design must distinguish

The following names are conceptual. Adopt, rename, combine, or reject them,
but make every equality relation explicit.

### 1. Module request identity

Current shape:

```text
(external, path, importAttributeType)
```

This owns loader evaluation/coalescing and ordered request slots. Positions do
not count. Two bindings from one package should normally share this identity.
An internal Haxe module identity and an external literal specifier remain
different even when their strings match.

### 2. Export binding identity

Candidate semantic fields:

```text
request identity
binding form: default | named | namespace
export selector: default | exact named export | whole namespace
native/member access path where it changes the selected runtime value
```

This answers whether two edges refer to the same runtime value before a local
alias is allocated. `DDefault`'s current `name` is often a desired local Haxe
name, not the export selector. `DAsterisk` similarly describes a namespace
binding rather than an export named after the local class. Do not use one
overloaded string for both concepts if that remains ambiguous.

### 3. Haxe declaration identity

Candidate source:

```text
DependencyPlan.moduleTypeKey(referencedType)
```

This answers which typed Haxe declaration an expression or annotation meant.
It may map many-to-one onto an export binding when two Haxe declarations
intentionally describe the same JavaScript value. Host-created imports without
a `ModuleType` need a separate stable origin or explicit “no declaration” case.

### 4. Emitted local binding identity

Candidate fields:

```text
canonical export binding ID
collision-resolved local identifier
```

This owns alias allocation and the final accessor result. Two different export
bindings that both want local `Foo` require distinct deterministic locals, for
example:

```ts
import Foo from "genes-binding-identity-fixture"
import {Foo as Foo__1} from "genes-binding-identity-fixture"
```

Combining them into one declaration is optional syntax, not a semantic
requirement. It is also valid to emit separate declarations if request order
and source maps remain correct.

## Equality matrix the answer must complete

Return an exact table for these operations:

| Operation | Proposed identity/equality | Important non-fields |
| --- | --- | --- |
| Ordered ESM request coalescing | ? | declaration, alias, import form? |
| Reachability de-duplication | ? | request/local alias? |
| Binding de-duplication | ? | declaration identity when aliases share one export? |
| Alias key and collision allocation | ? | edge kind/source position? |
| Runtime attachment to request slot | ? | declaration identity? |
| Runtime wins over type-only duplicate | ? | which binding relation? |
| Type-only plan de-duplication | ? | ? |
| Expression/type accessor lookup | ? | must start from typed declaration |
| Classic declaration import lookup | ? | must agree with implementation |
| Import-attribute conflict diagnostic | ? | attribute is request-level |
| Source-map provenance | ? | must never affect identity |

At minimum, test the matrix against:

1. same request, same named export, repeated edge;
2. same request, default versus named with the same text `Foo`;
3. same request, namespace versus named/default;
4. same export described by two Haxe declarations;
5. two different exports asking for the same local name;
6. explicit `@:genes.importAlias`;
7. same binding encountered first as type-only and later at runtime;
8. same binding with conflicting import attributes;
9. internal and external requests with the same path string;
10. compiler-created binding with no `ModuleType`;
11. dotted `@:jsRequire`/`@:native` compatibility paths; and
12. a side-effect-only request, which has no binding at all.

## Candidate directions to evaluate

These are hypotheses, not instructions.

### Candidate 1: one rich `BindingIdentity` stored directly on every dependency

Introduce an immutable value with request identity, form, export selector,
optional declaration key, and origin. `Dependency` carries it through alias
allocation and projection; `TypeAccessor` carries a declaration key and looks
up the canonical allocated binding.

Evaluate whether declaration identity belongs inside the binding's equality or
in a separate declaration-to-binding lookup. A single equality for every
operation is likely too coarse.

### Candidate 2: separate canonical export bindings from declaration mappings

Create one `ModuleBindingKey` for the actual ESM binding, then maintain:

```text
HaxeDeclarationKey -> ModuleBindingKey -> allocated local name
```

Host-created bindings use only the middle key plus provenance. Multiple Haxe
declarations may map to the same export binding; default and named `Foo` map to
different binding keys. Request coalescing remains separate.

Evaluate whether this is the smallest accurate model and where those maps live
without introducing mutable process-global state.

### Candidate 3: add `DependencyType` only to current equality and alias keys

This would preserve both fixture imports, but `TypeAccessor` would still ask
for only `(path, name)` and could select the first local. Explain whether any
small accessor extension makes this candidate complete; reject it if it merely
moves the ambiguity.

### Candidate 4: force different Haxe-side aliases in macros/fixtures

Require authors to add `@:genes.importAlias` or differently named extern
classes. This avoids the collision but makes a valid pair of Haxe declarations
depend on a manual compiler workaround and still leaves declaration lookup
lossy. Reject unless the language/compiler APIs make an automatic model
impossible, and then define a source-positioned fail-closed contract.

### Candidate 5: printer-local split or textual rewrite

Have each printer notice default-plus-named collisions and invent an alias.
This does not tell expression/type accessors which typed declaration owns which
local and risks TS/classic/declaration divergence. Reject unless you can prove a
shared semantic owner is unnecessary.

## Required invariants

1. The typed Haxe AST and compiler-owned `ModuleType` references remain the
   source of truth. Do not recover identity from generated strings.
2. Module evaluation/request coalescing remains independent from binding
   identity. One package request may carry several bindings.
3. Default, named, and namespace binding forms remain distinct even when their
   requested local names match.
4. Every typed Haxe declaration resolves to the exact canonical local selected
   for its runtime export. Do not return the first matching text name.
5. Runtime, type-only, and declaration-only projections agree on binding
   identity while retaining their separate reachability semantics.
6. Both implementation profiles consume one semantic plan. Target printers own
   only syntax.
7. Existing source encounter/request order, import attributes, aliases, DCE,
   source maps, and deterministic output remain intact.
8. No `Dynamic`, `untyped`, generated `any`, broad `unknown`, unchecked cast,
   raw target import string, process-global registry, or universal backend IR.
9. Invalid or genuinely ambiguous bindings fail before writers open, with a
   stable source-positioned diagnostic and no partial tree.
10. Existing output should remain byte-stable when no previously collapsed
    identity pair exists, unless a reviewed semantic correction requires
    otherwise.
11. New advanced Haxe records/enums/abstracts need beginner-readable Why/What/
    How hxdoc explaining the practical bug first, then the internal mechanism.
12. Classic Genes JS, genes-ts source, and classic `.d.ts` remain first-class.

## Questions the decision must resolve

1. Is `DependencyPlan.moduleTypeKey` a sufficient Haxe declaration key for
   accessor mapping across classes, enums, typedefs, abstracts, module-level
   fields, and secondary externs? If not, what compiler-owned key is?
2. Should `DependencyRequest` create binding identity inside
   `Dependencies.requests`, or should `DependencyPlanBuilder` combine a request
   with its originating `ModuleType` when it creates an edge?
3. Should `DependencyImport` store export binding identity and declaration
   origin separately? Which parts must survive `copyForProjection()`?
4. How does `Dependencies.pushAndGet` return both the canonical allocated
   binding and the mapping needed by accessors without rebuilding identity?
5. Should `TypeAccessor.Concrete` carry a declaration key, a binding key, or a
   small tagged lookup request? How are same-module and known-global paths kept
   simple?
6. How do module-field/field-expression `@:jsRequire` imports receive a stable
   binding key when `referencedType` is null?
7. When two Haxe declarations intentionally describe the exact same export,
   should they share one local? How is that intent established rather than
   guessed from simple names?
8. Does the current secondary-extern fallback create multiple Haxe declaration
   mappings to one binding, or does its alias mean the exports are distinct?
9. Can declaration-only projections allocate exactly the same aliases as
   implementation projections when their edge subsets differ? If not, what
   consistency is actually required for separate output files?
10. Which invariants should fail with a user diagnostic versus an internal
    assertion?
11. What is the smallest shadow comparison that proves existing imports and
    aliases are unchanged before switching consumers?
12. Are there Haxe compiler-server lifecycle hazards in caching declaration
    keys or mappings on `Module`/`Dependencies`?

## Required answer

Return a focused decision document with these sections:

1. **Verdict** — adopt/modify/reject every candidate and state the smallest
   production model.
2. **Identity records** — concise typed Haxe pseudocode for request, export
   binding, declaration origin/mapping, and allocated binding. Explain each in
   beginner-friendly language before internal field details.
3. **Equality matrix** — complete the table above and state every excluded
   field explicitly.
4. **Creation and flow** — exact ownership from `makeDependency`/requests and
   `DependencyPlanBuilder` through projection, alias allocation, `TypeAccessor`,
   and all three output surfaces.
5. **Fixture proof** — show the expected TS, classic JS, and classic `.d.ts`
   imports and why each constructor/type reference selects the correct local.
6. **Compatibility cases** — secondary externs, dotted/native paths, explicit
   aliases, namespace imports, type-only/runtime promotion, attributes, JSX/
   host imports, internal modules, and side-effect-only requests.
7. **Failure modes** — identity aliasing, over-splitting, divergent aliases,
   DCE/reachability changes, declaration mismatch, source maps, determinism,
   compiler-server state, and transaction safety.
8. **Incremental implementation plan** — separately reversible commits, shadow
   evidence, rollback points, focused commands, and final `yarn test:ci`.
9. **Test matrix** — exact positive, duplicate/coalescing, negative, TS/classic/
   declaration, TS 5/6/7, Haxe 4.3.7/5-preview, runtime, deterministic-tree,
   source-map, and transaction cases.
10. **Documentation obligations and open experiments** — only facts the upload
    cannot prove; do not invent a broad redesign or guessed output budget.

Do not return a generic explanation of ESM imports. The decision is specifically
about canonical identity and accessor ownership inside this repository.

## Focused files to upload

Create a Repomix XML containing at least:

- `AGENTS.md`, `package.json`, `haxelib.json`, `extraParams.hxml`, and
  `config/toolchains.json`;
- this prompt;
- `src/genes/Dependencies.hx`;
- `src/genes/DependencyPlan.hx`;
- `src/genes/DependencyPlanBuilder.hx`;
- `src/genes/TypeAccessor.hx`;
- `src/genes/TypeReferenceCollector.hx`;
- `src/genes/ExternTypeContract.hx`;
- `src/genes/Module.hx` and `src/genes/Context.hx`;
- `src/genes/util/TypeUtil.hx`;
- `src/genes/es/ModuleEmitter.hx` and `src/genes/es/ExprEmitter.hx`;
- `src/genes/ts/TsModuleEmitter.hx`;
- `src/genes/dts/DefinitionEmitter.hx` and `src/genes/dts/TypeEmitter.hx`;
- `src/genes/JsxPlan.hx` and the relevant import-helper producer in
  `src/genes/ts/Imports.hx`;
- the complete `tests/genes-ts/package-shapes` source/package/config fixture,
  excluding generated `out/` trees;
- `scripts/probe-binding-identity.ts` and `scripts/test-package-shapes.ts`;
- `docs/ARCHITECTURE.md`, `docs/OUTPUT_MODES.md`, and
  `docs/typescript-target/INTEROP.md`;
- focused import/order/output test owners such as
  `scripts/test-side-effect-import-evidence.ts`,
  `tests/side-effect-import`, and `tests/output-modes/profile-ownership.json`;
- the post-roadmap audit decision if present.

Do not include `node_modules`, generated output trees, `.tmp`, Git internals,
unrelated archives, secrets, lockfile contents unnecessary to the review, or
machine-local paths. The prompt contains the exact wrong generated import and
runtime transcript, so generated `out/` files are not required.
