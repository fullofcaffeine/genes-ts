# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

The repo tracks the roadmap in `.beads/issues.jsonl` so a fresh checkout includes the current plan.
Local runtime state (SQLite DB, daemon logs, etc) remains untracked.

`../genes-vanilla` is the read-only reference for the original upstream Genes implementation. Use it to compare original ES/JS behavior and architecture, especially for performance-oriented ES6 output, but do not patch it from this repo's compiler work. The source of truth for genes-ts/compiler changes is this `../genes` checkout.

## Compiler Independence

genes-ts is a general-purpose Haxe-to-TypeScript/JavaScript compiler.

- Downstream projects may and should reveal missing compiler features, bad emitted TypeScript, classic JS regressions, typing holes, macro ergonomics gaps, and runtime helper bugs.
- Fix those issues as generic language/codegen/runtime improvements with small reusable fixtures. Do not add knowledge of downstream project paths, module names, schemas, DTOs, runtime seams, CLI behavior, or product conventions.
- If a downstream case seems to need a compiler special case, first reduce it to the underlying Haxe/JS/TS construct and add that as the compiler test.
- If a compiler, macro, type-system, interop, or output-architecture issue becomes ambiguous, risky, or tempting to solve with a clever workaround, stop and prepare a detailed GPT 5.5 Pro prompt instead of guessing. Include the reduced repro, relevant files, current hypotheses, failed approaches, desired output, and non-negotiable architecture rules, then use the response to guide an elegant generic fix.
- The goal is to make genes-ts the best JS/TS compiler for Haxe. Compiler work only serves that goal when it benefits arbitrary Haxe projects too.

## Migration Tooling and Long-Term Consolidation

- `tools/ts2hx` is currently a TypeScript tool built on the TypeScript
  `Program`/`TypeChecker` API. It may use both Genes output profiles as runtime
  or differential evidence, but the Haxe-to-TS/JS compiler must remain usable,
  testable, and releasable without ts2hx. This dependency is intentionally
  one-way: migration tooling depends on the compiler, not the compiler on the
  migration tool.
- A future rewrite of ts2hx in strongly typed Haxe is a legitimate long-term
  possibility. It could consolidate implementation languages and exercise
  Genes on a demanding real compiler tool. Treat that as a separately designed
  bootstrap/self-hosting project, not as an assumption behind current patches.
- Before such a rewrite, prove how Haxe will consume the authoritative
  TypeScript compiler API, how a known-good Genes compiler bootstraps the tool,
  and how failures are distinguished from bugs in the compiler being tested.
  Preserve deterministic transactions, exact source provenance, strict and
  assisted diagnostics, TS-version isolation, and original-TS/classic/genes-ts
  differentials throughout the migration.
- Do not distort the current TypeScript implementation merely to make a future
  port look easier. Prefer small immutable semantic plans and typed boundaries
  that are good architecture today and would also translate cleanly later.

## Output modes (keep both green)

genes-ts intentionally supports **two output modes** within the same library:

1) **TypeScript source output** (genes-ts mode): enabled by `-D genes.ts`
2) **Classic Genes JS output** (ESM + optional `.d.ts`): default when `-D genes.ts` is not set

Both modes should remain well-maintained and share as much implementation as practical.

## CI Gate Is Mandatory

Full Genes CI must pass before downstream projects rely on a local compiler change.

- A compiler fix is not considered usable by downstream work until the full CI gate succeeds, including classic Genes JS mode, genes-ts TypeScript mode, snapshots, and security/dependency checks.
- Focused tests are useful while iterating, but they are not enough to unblock downstream port work if full CI is red.
- If full CI fails, stop downstream work and fix or explicitly resolve the Genes CI failure in this repo first. Do not continue building downstream projects on top of an unproven compiler checkout.
- If a CI failure is external or intentionally allowlisted, document the reason, the owning Bead, and the exact command/output proving the remaining compiler gates are healthy before downstream work resumes.

## Commit Messages

- Keep the conventional-commit subject concise, then add a useful commit body for every non-trivial change. Write the body in friendly, beginner-readable language so someone who does not already know the compiler internals can understand what problem was solved.
- Explain what changed, why it matters, and how it was verified. Call out important behavior or output changes and name any intentionally deferred scope so the commit does not imply broader closure than it provides.
- Prefer concrete descriptions of the old and new behavior over a list of filenames or internal type names. Technical details are welcome, but introduce them in plain language and make the practical outcome clear first.

## Pull Request Descriptions

- Make every PR description as concrete and specific as the available evidence
  permits. For compiler or generated-output changes, an architecture-only
  summary is not sufficient.
- Include the smallest useful positive example: the exact Haxe input or command
  and the relevant generated TS/JS, runtime transcript, or diagnostic.
- Include a negative or before-the-change example when behavior changes: show
  the exact missing/incorrect output, failure, or workaround, and explain why
  it is inadequate. When validation is part of the feature, name the exact
  diagnostic and publication/rollback result.
- State which output profiles and toolchain lanes were observed, and separate
  verified behavior from inferred or intentionally deferred scope. Keep
  examples minimal enough to review directly, but never replace specifics with
  vague claims such as “handles the edge case.”

## Epistemic Rigor and Friendly Explanations

- Do not let confidence substitute for evidence. Inspect the relevant source, generated output, runtime behavior, and owned tests before making non-trivial claims. Clearly distinguish what is directly observed, what is an inference from that evidence, and what still requires an experiment or external review.
- Avoid overclaiming from a small repro or one green profile. State the exact boundary that was proved, name important counterexamples and failure modes, and keep uncertain or deferred variants explicit. When compiler behavior is ambiguous or risky, reduce it, test it, and use the repository's architecture-review rule instead of guessing.
- Write comments and documentation for a capable reader who is new to this part of the compiler. Lead with the practical problem and outcome, then explain the invariant, mechanism, tradeoff, verification, and intentionally deferred scope in friendly language. Introduce jargon and internal names only after the underlying idea is clear.
- Preserve reasoning near the code that depends on it. Tests show that behavior works today; comments and docs should explain why the design is sound, what evidence supports it, and what a future maintainer must not accidentally break. Do not add narration that merely restates the code.

## Target-Polymorphic Type Helpers

North star: Haxe code that uses genes-provided TypeScript helper abstractions should still be ordinary Haxe code that can compile through both output modes.

- Helpers under packages such as `genes.ts` may expose richer TypeScript surfaces in `-D genes.ts` mode, for example `unknown`, `T | undefined`, import types, type queries, JSX element types, or other TS-only declaration shapes.
- Those helpers must degrade/erase cleanly in classic Genes JS output. TypeScript-only annotations should disappear, but runtime semantics must remain equivalent plain ES6.
- ES6 compatibility must not reduce TypeScript quality. The TypeScript emitter should still produce idiomatic, precise, readable TS with the strongest useful type surface the Haxe source can justify.
- Implement this through maintainable compiler architecture, not scattered target checks. Prefer shared semantic helper models plus target-specific emitters/printers, focused lowering phases, and reusable fixtures over ad hoc string rewrites or downstream-specific branches.
- A helper is not portable enough if it only works because the TypeScript emitter prints a clever type string. It must have a real Haxe/runtime representation, or an explicitly documented target guard, so classic JS output can run.
- When adding or changing a `genes.ts` helper, prefer paired fixtures where practical: one proves the rich TypeScript output, and one proves classic JS output still compiles/runs or intentionally reports a documented unsupported construct.
- If a Haxe program avoids TS-specific helper types entirely, it should compile to either TypeScript or ES6 without source changes. TypeScript output may still be richer because `genes-ts` emits declarations, stricter imports, and TS-native syntax, but plain JS output must remain a first-class target.
- Generic boundary primitives belong in `genes.ts` when they model reusable JS/TS semantics Haxe cannot express directly, such as `unknown`, `undefined`, record-like unknown objects, read-only unknown arrays, and guarded narrowing. Keep schema decoding, field defaults, error wording, compatibility policies, and product-specific payload knowledge in downstream libraries/apps or a separate decoder library, not in the compiler.

## Type safety (no `untyped` / no `Dynamic`)

For any Haxe-to-target compiler or framework layer, target compatibility is the floor, not the Haxe API design ceiling. Target-shaped Haxe APIs are fine, and sometimes the right canonical surface, when that shape is intentional: migration ergonomics, interop, differential testing, generated-output inspection, predictable target behavior, or preserving a widely understood host API. When there is no strong target-shaped reason, canonical APIs should default to leveraging Haxe's strengths: types, macros, generated refs, properties, editor completion, and compile-time diagnostics. Keep 1:1 target facades available at runtime/library boundaries and as escape hatches, then prefer semantic Haxe wrappers when they improve readability or safety without changing target behavior. Compiler fixtures should preserve both surfaces where useful: direct target-shaped examples prove compatibility, while Haxe-native wrappers prove the better authoring experience.

Prefer Haxe module-level functions when behavior is naturally module-scoped and no class identity, inheritance, interface implementation, or runtime export shape requires a class. Avoid unnecessary “shell” classes that only collect `public static` helpers; they add verbosity without improving the generated TypeScript or Haxe authoring experience.

Document every module and class with its purpose once it is more than a trivial DTO/fixture shim. Document functions when their control flow, boundary behavior, type modeling, error policy, or generated-output implications exceed what a reader can infer locally in a few lines. Keep docs useful and concise: explain why the abstraction exists, what contract it preserves, and any important boundary assumptions; do not add noise comments that merely restate names or assignments.

In **framework + test code** (including the todoapp harness), avoid:

- `untyped`
- `Dynamic` (and other "escape hatches" that erase types)

Prefer small, well-typed externs/abstracts and keep any unavoidable JS interop confined to a narrow boundary (e.g. `extern` modules or a single wrapper).

Use `Dynamic`, `untyped`, generated `any`, broad `unknown`, and equivalent weak types only as a last resort after confirming there is no practical typed alternative. If one is required, add a nearby comment explaining why the value cannot be typed yet and how the unsafety is contained.

For JSON-shaped fixtures, runtime helpers, or generated boundary APIs, prefer typed parsers/writers, precise typedefs, generated codecs, or a recursive JSON value algebra before using broad `Unknown`. An `Unknown` wrapper is not a domain model unless it restricts operations, emits a narrower target type, or is immediately paired with a decoder; otherwise document the allowed operations and why a typed model is not practical yet.

Treat `cast`, especially casts to or from `Dynamic`, as a last-resort boundary. If a cast is unavoidable because Haxe cannot express the runtime operation directly, keep its scope tiny, guard every operation performed through it, return typed values immediately, and add a nearby comment explaining the API limitation and containment.

Treat `@:ts.type(...)` / `@:genes.type(...)` as lower-level boundary overrides. Prefer inferred Haxe types and generic compiler/library constructs for recurring semantics. For example, use `@:ts.optional` for TypeScript `field?: T` optional-property contracts instead of hand-writing per-field `@:ts.type("T")` strings when the Haxe field type already expresses `T`. A raw TS type override is appropriate only when the canonical boundary type cannot be expressed cleanly with Haxe types, such as ecosystem import types, readonly projections, unique symbols, or host API signatures.

## Documentation quality (hxdoc)

Modules and classes should always have a short hxdoc/comment describing their
purpose, boundary contract, and why they exist. Document functions once they
cross a reasonable complexity threshold, especially when they hide validation,
interop, macros, codegen expectations, runtime assumptions, or non-obvious
tradeoffs. Prefer concise why/what/how notes over line-by-line narration.

For **vital or complex** code (compiler internals, runtime helpers, macros, harness/test infrastructure):

This repo should be a **world-class reference** for how to build and maintain a
real compiler/codegen pipeline in Haxe.

- Use **hxdoc** (`/** ... */`) and write it **didactically** with **Why / What / How**.
- Be explicit about the **compiler contract**:
  - inputs/outputs, determinism requirements, file layout, import policy,
  - compatibility assumptions (Node/TS/Haxe versions), and
  - the two output modes (classic JS vs TS source output).
- Prefer documenting the *contract* (inputs/outputs/side effects), invariants, and edge cases over restating obvious code.
- When a decision is non-obvious, document the **tradeoff** (why we chose it and what we rejected).
- Include examples when it clarifies non-obvious behavior (short snippets are fine).
- When landing compiler behavior changes, add nearby comments or hxdoc for the exact invariant being protected: why the emitter/macro/runtime helper needs special handling, what Haxe or TypeScript typing fact it relies on, how the generated output should look, and what future changes must not break. Tests prove the behavior; comments preserve the reasoning.

### Required hxdoc for advanced Haxe features

If you use intermediate/advanced Haxe features, add comprehensive hxdoc that explains:

- **Why** the feature is used (what problem it solves here)
- **What** it expands to / what it guarantees
- **How** it interacts with typing/codegen and what pitfalls exist

Examples of “advanced” constructs that should be documented when used:

- macros (`macro`, `haxe.macro.*`, reification/quoting/splicing, `Context.*`)
- codegen/emitters that depend on typing subtleties (e.g. `Null<T>`, abstracts, enum abstracts, overloads, type/value namespaces)
- `@:build` / `@:autoBuild`, `@:generic`, `@:using`, `@:forward`, `@:from`/`@:to`, `@:native`, `@:jsRequire`
- JS interop boundaries (`js.Syntax.code`, externs) and any runtime reflection hooks

Keep trivial helpers undocumented unless they hide important constraints.

### Required hxdoc for advanced metadata / interop annotations

If you use “advanced” compiler metadata that changes how code is typed/emitted (especially in examples/harness code), add hxdoc that explains:

- **Why** the annotation exists (what breaks or becomes worse without it)
- **What** the annotation changes in the generated TS/JS output
- **How** it works mechanically (e.g. what it lowers to / what contract it enforces)

Examples that must be documented when used:

- `@:ts.type(...)` (pins generated TS types to canonical ecosystem types/unions)
- `@:forward(...)` (controls abstract surface area + ergonomics)
- `@:native(...)` (binds to runtime identifiers; can change import/emit behavior)
- `@:jsRequire(...)` (interop boundary + import emission)

## Generated TS typing policy (no `any` / `unknown`)

- Generated TypeScript should be **idiomatic and strongly typed**.
- Avoid emitting `any` / `unknown` in **user modules**.
- `any` / `unknown` is only acceptable in a **small runtime boundary** (e.g. `genes/Register.ts`) and only when:
  - the behavior is inherently dynamic (reflection registry, prototype mutation, raw JS interop), and
  - there is no practical alternative.
- When `any` / `unknown` is used in runtime code, include a short comment explaining **why**.
- Treat Haxe's JS stdlib as the semantic baseline for genes-ts runtime behavior.
  TypeScript source is the typed emission surface, not a separate runtime target.
  If Haxe JS boot/runtime code mutates built-ins or relies on metadata such as
  `__name__`, `__class__`, `__super__`, `__interfaces__`, or enum metadata,
  model that shape in the TypeScript support emitters before reaching for
  `js.Syntax.code`, `cast`, `Dynamic`, broad global augmentations, or downstream
  workarounds.
- Keep stdlib support layers separate: Haxe source overrides under `src/haxe/**`
  are for real semantic/runtime incompatibilities; type emitters map Haxe types
  to TypeScript types; support emitters such as `StdTypesEmitter` describe
  generated runtime/global shapes and small TS lib gaps. Do not override Haxe
  stdlib source merely to satisfy a TypeScript declaration hole.
- Built-in global augmentations must stay narrow and evidence-based. Prefer
  optional declarations for built-ins that Haxe JS boot/runtime code actually
  writes or reads, and avoid broad declarations such as `interface Function` or
  `interface Object` unless a focused fixture proves they are the only sound
  boundary.

## TSX / JSX Runtime Policy

- Prefer Haxe inline markup (`return <div>...</div>`) as the default HHX/TSX authoring surface in genes-ts fixtures and downstream Haxe UI code. `genes.react.JSX.jsx("...")` remains supported for generated/migration code and parser limitations such as React fragment roots, but new handwritten examples should prove the inline-markup path first.
- Inline markup must preserve type safety at both levels: Haxe expression splices are parsed as real Haxe expressions, and generated `.tsx` must still let TypeScript validate intrinsic props, component props, children, handlers, and spread props.
- genes-ts React inline markup is default-on for `-D genes.ts` builds. Use `@:jsx_no_inline_markup` or `-D genes.react.no_inline_markup` only when a module genuinely needs to opt out of Haxe parser-level markup rewriting.
- HHX should be at least as capable as TSX and should improve UX where Haxe can do better: typed control helpers, domain-specific component facades, macro-derived prop/slot contracts, clearer diagnostics, and safer abstractions are welcome when they still emit idiomatic TSX/JS and remain framework-generic.
- Do not assume JSX types are always global React types. Some automatic runtimes expose `JSX` from their package entrypoint, so compiler fixtures should cover both ambient JSX and explicit `genes.ts.jsx_import_source` imports.
- TSX output should keep `JSX.Element` annotations readable and type-only. If a runtime needs a namespace import for types, emit `import type {JSX} from "..."` rather than introducing a runtime import.
- TSX fixtures should include reactive/accessor-shaped APIs such as signals and memos, imported components with children, spread props, and module imports together. Those patterns expose type/value import planning and JSX child/prop lowering issues earlier than static element-only fixtures.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
```

## Key Commands

```bash
# Classic Genes JS mode (baseline)
npm test

# genes-ts TypeScript output mode
npm run test:genes-ts
npm run test:genes-ts:minimal
npm run test:genes-ts:full
npm run test:genes-ts:tsx

# Output stability + sourcemaps
npm run test:genes-ts:snapshots
npm run test:genes-ts:sourcemaps

# Full acceptance (compiler + todoapp E2E)
npm run test:acceptance

# Todoapp E2E only
npm run test:todoapp:e2e

# Example build (TS output)
npm run build:example:genes-ts
npm run build:example:todoapp
```

## Landing the Plane (Session Completion)

**After each completed task**, commit and push the relevant repo before moving on to the next task. If work spans multiple repos, each repo gets its own focused commit and successful push. Do not batch completed tasks into a later session-level push.

For `../genes` specifically, keep the branch current with origin whenever landing compiler work: run `git pull --rebase` before the final push, resolve any upstream drift in the compiler repo itself, then push the focused genes commit. Downstream work may depend on local `../genes`, so do not leave compiler changes stranded or only documented elsewhere.

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
