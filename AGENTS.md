# Agent Instructions

This project uses **bd** (Beads) for issue tracking. Install the exact
repository client with `yarn beads:install`, then run `yarn bd onboard`.

## New agent: understand the repository first

genes-ts is a Haxe compiler backend for the JavaScript platform. Haxe parses,
types, and performs dead-code elimination on the program; Genes then reads that
typed Haxe tree and publishes one of two first-class implementation profiles:

```text
Haxe source -> Haxe typed AST -> genes.Generator
  -> TypeScript or TSX source          (-D genes.ts)
  -> classic split ESM JavaScript      (default, optionally with -D dts)
```

The repository also contains `tools/ts2hx`, an experimental migration tool that
uses the TypeScript compiler API to translate a proven subset of TypeScript or
JavaScript implementation source into Haxe. The dependency is one-way:
ts2hx may use Genes to compile and compare its generated Haxe, but Genes must
remain buildable and correct without ts2hx.

### First ten minutes

1. Run `yarn beads:install`, `yarn bd onboard`,
   `git status --short --branch`, and `git log -n 12 --oneline`.
2. Read [`docs/BEADS_WORKTREES.md`](docs/BEADS_WORKTREES.md) before creating a
   branch or worktree. Use `yarn bd ready`, inspect the selected task with
   `yarn bd show <id>`, then claim it with
   `yarn bd update <id> --status in_progress`.
3. Read [`docs/README.md`](docs/README.md) for the documentation index.
4. Choose the intended user workflow in
   [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md): Haxe to TypeScript, Haxe to
   classic JavaScript, one-source dual output, or TypeScript to Haxe.
5. Before changing compiler semantics, read
   [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the scoped
   [`src/genes/AGENTS.md`](src/genes/AGENTS.md).
6. Before changing ts2hx, read
   [`tools/ts2hx/AGENTS.md`](tools/ts2hx/AGENTS.md) and
   [`docs/ts2hx/USAGE.md`](docs/ts2hx/USAGE.md).
7. Find the smallest owning fixture and focused command in
   [`docs/TESTING_STRATEGY.md`](docs/TESTING_STRATEGY.md). A snapshot proves
   source shape; runtime, type-negative, declaration-consumer, source-map, and
   transaction claims need their corresponding evidence owner.
8. Install the repository pre-commit guard once per clone:
   `yarn haxelib install formatter 1.18.0 --quiet && yarn hooks:install`.
   It composes with Beads, formats complete staged `.hx` files, and scans the
   final staged snapshot for credentials before Git creates a commit. See
   [Local pre-commit protection](#local-pre-commit-protection).

### Use the compiler

From a fresh checkout:

```bash
corepack enable
yarn install

# Build, type-check, and run the small maintained dual-output example.
yarn build:example:genes-ts

# Build all maintained examples in their declared profiles.
yarn test:examples
```

The smallest maintained HXML files are:

- [`examples/typescript-target/build.hxml`](examples/typescript-target/build.hxml)
  for Haxe to TypeScript (`-D genes.ts`);
- [`examples/typescript-target/build.classic.hxml`](examples/typescript-target/build.classic.hxml)
  for Haxe to direct ESM JavaScript and declarations.

Do not infer the output profile from a filename alone. The Haxe command still
uses `-js` in both cases because Genes is installed as a custom JavaScript
generator. `-D genes.ts` selects TypeScript source; omitting it selects classic
Genes JavaScript. Read [`docs/OUTPUT_MODES.md`](docs/OUTPUT_MODES.md) for the
complete contract.

### Use ts2hx

```bash
yarn --cwd tools/ts2hx build
node tools/ts2hx/dist/cli.js --help

# Translate the smallest checked fixture into a disposable Haxe tree.
node tools/ts2hx/dist/cli.js \
  --project tools/ts2hx/fixtures/minimal-codegen/tsconfig.json \
  --out /tmp/ts2hx-out \
  --runtime-profile genes-esm \
  --clean
```

Exit `0` means the encountered program fit ts2hx's currently verified subset;
it does not claim arbitrary TypeScript support. Inspect
`/tmp/ts2hx-out/ts2hx-manifest.json`, then read
[`docs/ts2hx/LIMITATIONS.md`](docs/ts2hx/LIMITATIONS.md) before relying on the
translation. Use dts2hx or handwritten externs—not ts2hx—when the input is an
npm package's declaration-only `.d.ts` surface.

### Navigate by ownership

| Question | Start here | Why |
| --- | --- | --- |
| How does a build enter Genes and publish files? | `src/genes/Generator.hx`, `src/genes/OutputTransaction.hx` | Generator coordinates one compilation; the transaction owns complete-tree publication and rollback. |
| Which modules and imports survive? | `src/genes/DependencyPlan*.hx`, `src/genes/BindingIdentity.hx`, `src/genes/PublicSurface.hx` | Runtime, type-only, declaration-only, and side-effect facts have different identities and reachability rules. |
| How is TypeScript emitted? | `src/genes/ts/TsModuleEmitter.hx`, `src/genes/ts/TsNarrowingPlan.hx` | The emitter owns TS syntax; the narrowing plan owns function-local flow facts. |
| How is classic JavaScript emitted? | `src/genes/es/ModuleEmitter.hx`, `src/genes/es/ExprEmitter.hx` | Classic output is direct split ESM JavaScript and remains a first-class runtime profile. |
| How are classic declarations emitted? | `src/genes/dts/DefinitionEmitter.hx`, `src/genes/dts/TypeEmitter.hx` | Declaration reachability is separate from classic runtime DCE. |
| Where do shared runtime semantics live? | `src/genes/Register.hx`, `src/genes/js/`, `src/haxe/` | These preserve Haxe JavaScript behavior shared by both profiles. |
| How do HXX and JSX work? | `src/genes/react/`, `src/genes/JsxTypeChecker.hx`, `src/genes/JsxPlan.hx` | Haxe validates markup first; all four JSX/createElement profiles consume one checked semantic plan. |
| How can a host watch, rebuild, and publish Genes output safely? | `tooling/README.md`, `tooling/src/`, `tooling/AGENTS.md` | Optional Node-side primitives own generic lifecycle mechanics while framework policy stays in the host. |
| How does TS become Haxe? | `tools/ts2hx/src/project.ts`, `tools/ts2hx/src/semantic/`, `tools/ts2hx/src/haxe/` | TypeScript facts are normalized before the Haxe emitter publishes a transactional tree. |

Use `rg` before browsing broad directories. Search for the emitted token,
diagnostic ID, metadata name, or fixture command; then follow the owning plan
or emitter named by the nearest documentation. Do not begin by editing a
printer if the same decision affects more than one output surface.

### Documentation authority

- [`readme.md`](readme.md): product overview and shortest installation example.
- [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md): end-to-end commands for every
  supported direction.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): compiler phases, semantic
  ownership, source layout, and fixture routing.
- [`docs/typescript-target/COMPILER_CONTRACT.md`](docs/typescript-target/COMPILER_CONTRACT.md):
  generated TypeScript file, import, and define contract.
- [`docs/typescript-target/INTEROP.md`](docs/typescript-target/INTEROP.md):
  consuming JavaScript/TypeScript from Haxe and consuming generated output.
- [`docs/TESTING_STRATEGY.md`](docs/TESTING_STRATEGY.md): focused versus full
  gates and what each kind of evidence proves.
- [`docs/RELEASING.md`](docs/RELEASING.md): Conventional Commit versioning,
  exact-tested-commit publication, deterministic Haxelib artifacts, immutable
  host controls, and safe recovery.
- [`docs/TOOLCHAINS.md`](docs/TOOLCHAINS.md): pinned Node, Haxe, and TypeScript
  lanes.
- [`docs/NULL_SAFETY.md`](docs/NULL_SAFETY.md): scoped Haxe source checking,
  TypeScript strict nulls, JavaScript representation, and escape policy.
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md): common setup, output,
  import, source-map, and migration failures.

If these instructions disagree with a more specific guide, verify the live
code and commands, then repair the stale documentation in the same change.
Documentation is part of the compiler contract, not an optional follow-up.

## Local pre-commit protection

The hosted `Secrets (gitleaks)` check is required before merge, but hosted CI
starts only after a branch reaches GitHub. Install the repository hook so the
first secret scan happens before Git creates the local commit:

```bash
yarn haxelib install formatter 1.18.0 --quiet
yarn hooks:install
```

Installation is explicit because `yarn install` must not silently change a
developer's Git configuration. The installer first asks Beads to install its
supported common hook, then adds one separately marked Genes section. Repeating
the command, or reinstalling/upgrading Beads, preserves both owners and any
unrelated hook content. Do not hand-edit `.git/hooks/pre-commit`.

On every commit, the hook:

1. finds staged `.hx` files;
2. rejects any staged Haxe file that also has unstaged edits, because automatic
   `git add` would otherwise sweep hidden work into the commit;
3. applies the existing `hxformat.json` policy and re-stages those complete
   Haxe files; and
4. runs the pinned gitleaks scanner against the final Git index.

The hook formats only Haxe files participating in that commit. It does not
bulk-reformat the historical source tree. A credential finding or missing
formatter/scanner prerequisite fails closed. `--no-verify` bypasses this local
boundary and is not a normal workflow; if an emergency requires it, run
`yarn precommit:run` first and explain the bypass in the handoff.

Verify installation, formatting, and linked-worktree behavior with:

```bash
yarn test:precommit-hook
```

The required full-history `yarn test:secrets` CI gate remains authoritative
after push. See [`docs/SECURITY.md`](docs/SECURITY.md) for the distinction.

The repo tracks the roadmap in `.beads/issues.jsonl` so a fresh checkout includes the current plan.
Local runtime state (SQLite DB, daemon logs, etc) remains untracked.

## Beads and linked Git worktrees

Beads has two different kinds of state in this repository:

- the Dolt database under `.beads/` is the live issue tracker and is shared by
  every linked Git worktree;
- `.beads/issues.jsonl` is a reviewed Git snapshot that lets a fresh checkout
  recover the roadmap. It is not the live database and is not a full backup.

Automatic JSONL export and staging are intentionally disabled in
`.beads/config.yaml`. A Git hook running in one linked worktree must never
rewrite or stage the primary checkout's roadmap file. Do not re-enable
`export.auto` or `export.git-add`, and do not edit the Beads-managed hook files
as a workaround. Use `yarn hooks:install` for the separately marked repository
pre-commit section; reinstalling or upgrading Beads replaces only its own
managed marker.

Normal `yarn bd create`, `yarn bd update`, and `yarn bd close` commands may run
from any worktree because the launcher resolves one verified client from Git's
common directory and updates the shared database. Do not use ambient `bd` or a
neighboring repository's cached binary: Beads database compatibility follows
the compiled migration set and exact source commit, not just the displayed
semantic version. Publish the tracked snapshot only as a deliberate second
step:

1. Finish and merge the feature worktree.
2. Use the clean, current primary `main` checkout.
3. Run `yarn beads:export`.
4. Review only `.beads/issues.jsonl`.
5. Create a dedicated roadmap branch, commit the snapshot, and merge it through
   a pull request after the required checks pass.

`yarn beads:export` also verifies the pinned client and fails closed in a linked
worktree, on a non-`main` branch,
when `main` is not equal to `origin/main`, or when the primary checkout is
already dirty. Never use `bd export` directly from a feature worktree. If a
worktree commit unexpectedly mentions an export, stop and follow the recovery
guide instead of resetting or overwriting files.

See [docs/BEADS_WORKTREES.md](docs/BEADS_WORKTREES.md) for the practical model,
safe commands, upgrade procedure, regression test, and recovery checklist.

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

## Performance Is a Review Requirement

Treat performance as part of compiler correctness on every pull request, not as
cleanup reserved for an optimization project. A change can preserve types and
runtime behavior while still making editor builds noticeably slower, emitting
unnecessarily large programs, or adding work to every generated call.

For each PR, classify and report the affected cost surfaces:

- **compiler work:** cold and warm compile latency, peak memory, repeated typed
  AST walks, allocation, filesystem churn, and compiler-server reuse;
- **generated output:** module, byte, token, import, helper, and temporary
  counts in both TypeScript and classic JavaScript profiles; and
- **generated program work:** startup and hot-path runtime, allocation,
  evaluation count, and bundle/runtime loading behavior.

Use the smallest representative measurement that can distinguish the proposed
implementation from a plausible slower one. Reuse an existing focused
benchmark or output-quality fixture when it owns the affected path; add one
when new work enters a hot path. Compare the base and proposed revisions while
holding the fixture, toolchain, and machine constant where practical, or use a
same-run control. Report the command, sample count, before/after result, and
variance. If a PR is genuinely performance-neutral, say why—for example,
documentation-only work or a diagnostic branch that runs only after
compilation has already failed—instead of leaving the question unanswered.

CI thresholds must be evidence-based:

- Deterministic structural costs use blocking reviewed ceilings. The existing
  `yarn test:output-quality` gate fixes module counts, allows at most the
  reviewed 5% byte/token window, and permits no unreviewed growth in imports or
  lowering temporaries for its bounded corpus.
- Timing or memory becomes blocking only after a stable harness records warmup,
  repeated samples, expected CI variance, a pinned environment, and a reviewed
  regression boundary. Prefer a relative comparison with a same-run control
  over a brittle absolute wall-clock limit.
- A new noisy timing report may begin as advisory, but it must not be described
  as regression protection. Create an owning Bead with the measurements needed
  to graduate it to a blocking budget. Do not copy one developer-machine
  result into CI as an arbitrary threshold.

Optimize the measured cause without weakening semantic evidence, source maps,
readability, determinism, or either output profile. Avoid speculative
micro-optimizations and opaque caches: a faster implementation is an
improvement only when its identity, lifetime, invalidation, and output remain
reviewable. See [`docs/TESTING_STRATEGY.md`](docs/TESTING_STRATEGY.md#performance-evidence-and-ci-budgets)
for the current gates and threshold rules.

## Generated Source Should Look Hand-Authored

Treat generated TypeScript, TSX, JavaScript, and JSX as a product surface that
people will read, debug, review, profile, and sometimes publish.
Correct execution and successful type checking are the floor.
Within the constraints of Haxe semantics, the output should look as though a
careful developer wrote it directly for the target ecosystem.

Prefer natural target-language structure:

- precise, readable TypeScript types rather than redundant assertions,
  repeated null unions, artificial aliases, or weak boundary types;
- ordinary modern ESM imports, stable descriptive local names, and direct
  expressions when evaluation does not need a temporary;
- familiar TypeScript/JavaScript control flow and standard-library operations
  when they preserve Haxe evaluation order and runtime behavior;
- canonical TSX/JSX spelling, minimal wrappers, and framework-native component
  and callback shapes; and
- concise classic JavaScript that does not retain type-projection scaffolding
  merely because the TypeScript profile needed it.

Do not pursue prettier output by changing semantics. Haxe evaluation order,
single evaluation of effectful expressions, null/undefined behavior, class and
enum runtime metadata, import side effects, dead-code elimination, source-map
provenance, deterministic naming, and both output profiles remain
authoritative. A temporary, helper, assertion, or wrapper is justified when it
protects one of those contracts; document the reason when the generated shape
would otherwise surprise a reader.

Every code-generation PR must inspect representative generated files, not only
the Haxe fixture or a green compiler exit. Protect important source shapes with
the smallest useful snapshot or exact-token assertion, then pair that shape
evidence with runtime, strict TypeScript, declaration-consumer, and source-map
checks as applicable. Review both TypeScript and classic JavaScript output when
the semantic decision is shared. If the safest current output is noticeably
less idiomatic, state the constraint and create a focused follow-up instead of
hiding it behind a cosmetic printer rewrite.

## Commit Messages

- Keep the conventional-commit subject concise, then add a useful commit body for every non-trivial change. Write the body in friendly, beginner-readable language so someone who does not already know the compiler internals can understand what problem was solved.
- Explain what changed, why it matters, and how it was verified. Call out important behavior or output changes and name any intentionally deferred scope so the commit does not imply broader closure than it provides.
- Prefer concrete descriptions of the old and new behavior over a list of filenames or internal type names. Technical details are welcome, but introduce them in plain language and make the practical outcome clear first.

## Pull Request Descriptions

- Write every PR description as a standalone explanation for a capable
  programmer who is new to this repository and has not followed the preceding
  issue, review, or agent conversation. Lead with the ordinary user workflow,
  the concrete failure or missing guarantee, who experiences it, and the value
  of the change. Introduce compiler-internal names only after that context is
  clear, and define unfamiliar terms in plain language at first use.
- A PR description is not ready when a newcomer must inspect the diff, open an
  earlier issue, or already understand an internal plan/emitter/fixture name to
  learn why the work exists. Links may provide deeper history, but the
  description must summarize the necessary context itself.
- Make every PR description as concrete and specific as the available evidence
  permits. For compiler or generated-output changes, an architecture-only
  summary is not sufficient.
- Explain why the change was needed and how the need was discovered. Name the
  concrete project, workflow, or use case when it is safe to disclose; show the
  exact observed output or failure; explain why existing mechanisms were
  inadequate; and state why the reduced, generalized fix belongs in this
  repository. Discovery context may be downstream-specific, but compiler code
  and fixtures must remain reusable and consumer-neutral.
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
- Assume the reader understands programming but has not followed the surrounding compiler work. Define an unfamiliar term in plain language before relying on it, explain why a surprising fixture or implementation exists before describing its mechanics, and avoid references that make sense only with issue or review history in mind. When a nearby guide, architecture section, fixture, or test command can answer the reader's likely next question, add a short `See also` reference instead of expecting them to discover that context alone.
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

For JavaScript-first collection code, prefer familiar typed operations such as
`map`, `filter`, `find`, `findIndex`, `some`, `every`, `flatMap`, `reduce`,
`reduceRight`, and `at` when their Haxe contract and generated ES/TS remain
faithful and idiomatic. Check the Haxe standard library and existing Genes
surfaces before adding anything. When an ECMAScript operation is genuinely
missing, keep two contracts distinct:
a precise `genes.js` API for authors who deliberately want native JavaScript
semantics such as `undefined`, sparse-array behavior, callback arguments, and
mutation visibility; and a semantics-preserving compiler lowering for portable
Haxe APIs such as `Lambda.find`, whose `Null<T>` result must not silently become
JavaScript `undefined`. Inspect generated output before preferring a fluent call:
retaining an indirect Lambda/helper module is not an ergonomic improvement over
a clear loop. Functional pipelines are preferred when their transformations
and accumulator type remain easy to follow; keep loops when they better express
indexed mutation, multiple mutable accumulators, allocation control, evaluation
order, or early control flow.
Node bindings such as hxnodejs are not the owner of ECMAScript language APIs.

Prefer Haxe module-level functions when behavior is naturally module-scoped and no class identity, inheritance, interface implementation, or runtime export shape requires a class. Avoid unnecessary “shell” classes that only collect `public static` helpers; they add verbosity without improving the generated TypeScript or Haxe authoring experience.

Document every module and class with its purpose once it is more than a trivial DTO/fixture shim. Document functions when their control flow, boundary behavior, type modeling, error policy, or generated-output implications exceed what a reader can infer locally in a few lines. Keep docs useful and concise: explain why the abstraction exists, what contract it preserves, and any important boundary assumptions; do not add noise comments that merely restate names or assignments.

In **framework + test code** (including the todoapp harness), avoid:

- `untyped`
- `Dynamic` (and other "escape hatches" that erase types)

Prefer small, well-typed externs/abstracts and keep any unavoidable JS interop confined to a narrow boundary (e.g. `extern` modules or a single wrapper).

Use `Dynamic`, Haxe `Any`, `untyped`, generated `any`, broad `unknown`, and equivalent weak types only as a last resort after confirming that a precise Haxe type, generic, abstract, extern, macro-derived reference, or guarded wrapper cannot model the operation. If one is required, add a nearby inline comment explaining why compile-time typing is not practical, which operations are allowed, and how the unsafety is contained before a typed value returns to ordinary code.

For JSON-shaped fixtures, runtime helpers, or generated boundary APIs, prefer typed parsers/writers, precise typedefs, generated codecs, or a recursive JSON value algebra before using broad `Unknown`. An `Unknown` wrapper is not a domain model unless it restricts operations, emits a narrower target type, or is immediately paired with a decoder; otherwise document the allowed operations and why a typed model is not practical yet.

Treat `cast`, especially casts to or from `Dynamic`, as a last-resort boundary after precise types, generics, abstracts, externs, macros, and guarded wrappers have been ruled out. If a cast is unavoidable because Haxe cannot express the runtime operation directly, keep its scope tiny, guard every operation performed through it, return typed values immediately, and add a nearby inline comment explaining the API limitation and containment.

Treat `@:ts.type(...)` / `@:genes.type(...)` as lower-level boundary overrides. Prefer inferred Haxe types and generic compiler/library constructs for recurring semantics. For example, use `@:ts.optional` for TypeScript `field?: T` optional-property contracts instead of hand-writing per-field `@:ts.type("T")` strings when the Haxe field type already expresses `T`. A raw TS type override is appropriate only when the canonical boundary type cannot be expressed cleanly with Haxe types, such as ecosystem import types, readonly projections, unique symbols, or host API signatures.

## Documentation quality (hxdoc)

Documentation is a release requirement, not follow-up cleanup. A compiler,
runtime, macro, interop, or generated-output change is incomplete until the
relevant public guide and nearby code contract explain it in beginner-friendly
language. Land those docs in the same PR as the behavior they describe. Include
the practical before/after outcome, why the design is sound, the exact boundary
proved by tests, important unsupported or deferred cases, and the commands a
future maintainer can run to verify it. Do not rely on an issue, review thread,
Oracle transcript, or commit message as the only explanation of a non-obvious
decision.

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

- Prefer Haxe inline markup (`return <div>...</div>`) as the default HXX/TSX authoring surface in genes-ts fixtures and downstream Haxe UI code. `genes.react.JSX.jsx("...")` remains supported for generated/migration code and parser limitations such as React fragment roots, but new handwritten examples should prove the inline-markup path first.
- Haxe is the authoritative HXX checker. Resolve component identities and intrinsic providers through real Haxe types, and reject unknown/missing/wrong props, unsafe spreads, incompatible handlers, and invalid children with source-spanned Haxe diagnostics before output. TypeScript remains an independent generated-output parity oracle, never the first or only checker.
- Preserve exact embedded value types through compiler-owned HXX carriers; do not route heterogeneous props or children through `Dynamic`, `Any`, `unknown`, casts, reflection, or untyped arrays. Contextual callback typing and generic prop inference are part of the HXX developer experience, not downstream TypeScript cleanup.
- Keep all four profiles on one checked semantic plan: `.tsx` preserves JSX plus Haxe-derived TypeScript types, `.jsx` preserves JSX with those types erased, `.ts` emits typed `createElement`, and `.js` emits equivalent runtime calls. A profile may choose syntax, but must not reinterpret validation or runtime ordering.
- Prefer canonical JSX spelling in both handwritten fixtures and generated source. Emit compile-time strings as static attributes such as `className="panel"`, not redundant expression containers such as `className={"panel"}`; use braces only for genuinely dynamic expressions and protect normalization with snapshots.
- genes-ts React inline markup is default-on for `-D genes.ts` builds. Use `@:jsx_no_inline_markup` or `-D genes.react.no_inline_markup` only when a module genuinely needs to opt out of Haxe parser-level markup rewriting.
- HXX should be at least as capable as TSX and should improve UX where Haxe can do better: typed control helpers, domain-specific component facades, macro-derived prop/slot contracts, clearer diagnostics, and safer abstractions are welcome when they still emit idiomatic TSX/JS and remain framework-generic.
- Do not assume JSX types are always global React types. Some automatic runtimes expose `JSX` from their package entrypoint, so compiler fixtures should cover both ambient JSX and explicit `genes.ts.jsx_import_source` imports.
- TSX output should keep `JSX.Element` annotations readable and type-only. If a runtime needs a namespace import for types, emit `import type {JSX} from "..."` rather than introducing a runtime import.
- TSX fixtures should include reactive/accessor-shaped APIs such as signals and memos, imported components with children, spread props, and module imports together. Those patterns expose type/value import planning and JSX child/prop lowering issues earlier than static element-only fixtures.

## Quick Reference

```bash
yarn bd ready              # Find available work
yarn bd show <id>          # View issue details
yarn bd update <id> --status in_progress  # Claim work
yarn bd close <id>         # Complete work
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

# Warm Haxe compiler-server equivalence (stable blocking; preview advisory)
npm run test:compiler-server

# Raw/structured post-staging failure rollback (stable + preview)
npm run test:compiler-server:rollback

# Full acceptance (compiler + todoapp E2E)
npm run test:acceptance

# Todoapp E2E only
npm run test:todoapp:e2e

# Example build (TS output)
npm run build:example:genes-ts
npm run build:example:todoapp
```

## Landing the Plane (Session Completion)

**After each completed task**, commit, push, and merge the relevant pull request
before moving on to the next task. If work spans multiple repos, each repo gets
its own focused commit and protected merge. Do not batch completed tasks into a
later session-level push.

For `../genes` specifically, keep the feature branch current with origin whenever landing compiler work: rebase it onto `origin/main` before the final push, resolve any upstream drift in the compiler repo itself, then push and merge the focused pull request. Downstream work may depend on local `../genes`, so do not leave compiler changes stranded or only documented elsewhere. The active `main` ruleset rejects direct pushes, including roadmap-only updates.

### Review Feedback Is a Merge Gate

Before every merge, inspect the pull request conversation as well as its CI
checks. Read general comments and submitted reviews.
Read every unresolved inline review thread on the current head.
A green check summary does not prove that a reviewer concern was addressed,
and the ordinary PR conversation view may not show whether an inline thread
remains unresolved.

Address actionable feedback in code, tests, documentation, or the PR
description as appropriate. Reply with evidence when a comment needs
clarification or is intentionally not adopted; do not silently dismiss it or
mark it resolved merely to make the PR mergeable. After the final push or
rebase, recheck comments and review-thread state because reviewers and bots may
have added feedback against the replacement head. Merge only when required
checks are green.
Every remaining comment must have an explicit, reviewable disposition.

**When ending a work session**, you MUST complete ALL steps below. Work is NOT
complete until the required pull request(s) merge and local `main` matches
`origin/main`.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH AND MERGE THROUGH PULL REQUESTS** - This is MANDATORY:
   ```bash
   # Feature branch/worktree:
   git fetch origin main
   git rebase origin/main
   git push -u origin <feature-branch>
   gh pr create --fill
   gh pr checks --watch
   gh pr merge --squash --delete-branch

   # If Beads state changed, publish it separately from a clean primary main:
   PRIMARY_WORKTREE="$(
     git worktree list --porcelain |
       awk '/^worktree / { print substr($0, 10); exit }'
   )"
   cd "$PRIMARY_WORKTREE"
   git switch main
   git pull --ff-only
   yarn beads:export
   git switch -c chore/beads-roadmap-<issue-id>
   git add .beads/issues.jsonl
   git commit -m "chore(beads): publish roadmap state"
   git push -u origin chore/beads-roadmap-<issue-id>
   gh pr create --fill
   gh pr checks --watch
   gh pr merge --squash --delete-branch
   git switch main
   git pull --ff-only
   git status  # MUST show main up to date with origin
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until the required pull request(s) merge and local
  `main` is synchronized with `origin/main`
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If a push, required check, or merge fails, resolve it and retry until the
  protected workflow succeeds
