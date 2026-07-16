# GPT-5.6 Pro review: post-roadmap compiler architecture and code-quality audit

You are GPT-5.6 Pro acting as a principal compiler architect, adversarial code
reviewer, and release-evidence auditor. Perform a read-only, evidence-first deep
review of the supplied genes-ts repository snapshot. Do not implement a patch
in this first pass. Do not merely summarize the repository or praise the test
suite. Look for correctness defects, semantic ambiguity, accidental complexity,
duplicated decisions, weak boundaries, stale compatibility paths, misleading
documentation, and tests that prove less than their names or prose imply.

The production baseline is commit
`929ea93d9dbeb57098d9ffdc301fce524bcccfa8` (2026-07-16), whose subject is
`feat(ts2hx): support typed package bindings`. The only post-baseline repository
changes in the upload should be this review prompt and Bead `genes-5xz`, which
tracks the audit. No production behavior was intentionally changed while
preparing the bundle.

## Evidence discipline

Use these labels throughout the answer:

- **Observed**: directly established by an uploaded source, fixture, generated
  artifact, manifest, or executable test owner.
- **Inference**: a conclusion derived from observed evidence. State the chain
  of reasoning and what could falsify it.
- **Experiment required**: a behavior, performance characteristic, compiler
  fact, or compatibility claim the upload cannot establish. Name the smallest
  fixture and exact repository command that would resolve it.

For every material finding, cite uploaded paths and line ranges. Correct any
claim in this prompt that the repository disproves. Keep facts, preferences,
and speculative cleanup ideas separate. A large file, repeated-looking code,
or unusual abstraction is not automatically a defect: identify the duplicated
semantic decision or practical maintenance/correctness cost. Conversely, a
green test or an explanatory comment is not proof that its underlying invariant
is sound.

Use clear, friendly language that a competent engineer new to this compiler can
follow. Introduce compiler-specific terms before relying on them. Do not hide
uncertainty behind confident prose. Prefer a short explanation of the old and
new observable behavior over lists of internal type names.

## Project north star and boundaries

genes-ts is one general-purpose Haxe-to-TypeScript/JavaScript compiler with
three first-class output surfaces:

1. strict, readable TypeScript/TSX implementation source under `-D genes.ts`;
2. modern classic Genes ESM JavaScript by default;
3. optional TypeScript declarations for classic JavaScript.

The typed Haxe AST is authoritative. Shared semantic facts should be extracted
only where they remove real duplication or preserve meaning across profiles;
this is not permission to build a universal IR. Classic Genes and genes-ts must
remain first-class and must preserve Haxe's JavaScript runtime semantics.

`tools/ts2hx` is currently implemented in TypeScript using the TypeScript
Compiler API. It is a strict-subset migration and assisted-scaffolding tool,
not a lossless TypeScript-to-Haxe compiler. It may use genes-ts to validate and
execute generated Haxe, but production compiler correctness and release gates
must not depend on ts2hx migration output. A future Haxe-authored ts2hx rewrite
is only a long-term bootstrap/self-hosting possibility: it would need an
independent bootstrap chain and must not create circular authority.

`../genes-vanilla` is a read-only upstream reference and is not included in this
current-repository bundle. If a conclusion requires direct vanilla comparison,
mark it **experiment required** rather than assuming either tree is correct.

## Non-negotiable repository rules

- Do not recommend a Reflaxe port, a second compiler engine, a universal IR, or
  a broad rewrite.
- Do not introduce downstream project paths, schemas, DTOs, module names, CLI
  policies, or product behavior into compiler code.
- Do not solve compiler work with `untyped`, `Dynamic`, generated `any`, broad
  `unknown`, unchecked casts, raw target-language control-flow strings, or a
  process-global registry. A narrowly documented host-runtime boundary is
  acceptable only when the behavior is inherently dynamic and operations are
  contained and guarded.
- Runtime, type-only, declaration-only, and binding-free module-request facts
  must remain semantically distinct. Map iteration is not an ordering proof.
- Both printers must consume shared meaning without being forced into identical
  syntax or duplicated target-specific branches.
- Unsupported ts2hx input must remain deterministic, source-positioned,
  transactional, and fail-closed. Assisted output carries an explicit loss and
  makes no executable-parity claim.
- Output ownership, stale-file removal, source maps, DCE, evaluation order,
  initialization order, declarations, import identity, and deterministic names
  are compiler contracts, not cosmetic details.
- Advanced Haxe features, macros, metadata, generics, `Null<T>` behavior, and JS
  interop need concise didactic Why/What/How hxdoc. Comments should preserve the
  invariant and tradeoff rather than narrate obvious assignments.
- Every proposed test must say exactly which incorrect implementation would
  still pass without it.

## Current state to verify, challenge, or refine

Treat the following as review leads, not trusted conclusions:

- The earlier 2026-07-14 audit produced `docs/ARCHITECTURE_ROADMAP.md`. Since
  then, the repository landed shared public-surface, nullish, dependency, JSX,
  naming/temporary, output-transaction, compatibility-evidence, and ts2hx
  semantic-planning work. The tracked queue reached 221 closed issues and no
  open work immediately before this audit; creating `genes-5xz` made the audit
  the sole in-progress Bead.
- Full `yarn test:ci` passed at the production baseline in the preceding work
  session. This is supplied execution evidence, not permission to infer that
  every semantic claim is covered.
- The main TS printer remains large (`src/genes/ts/TsModuleEmitter.hx`), the
  classic expression emitter remains a central semantic seam
  (`src/genes/es/ExprEmitter.hx`), and ts2hx's Haxe emitter
  (`tools/ts2hx/src/haxe/emit.ts`) is especially large. Determine whether these
  files still duplicate mutable reasoning or are merely large because printing
  a language is inherently broad.
- `DependencyPlan`, ordered runtime requests, `Dependencies`, and the two
  implementation printers were recently changed for side-effect imports,
  bound request ordering, transitive ordering, attributes, and package
  bindings. Look for two representations of the same fact, compatibility APIs
  that no longer have a consumer, alias/order mismatches, and request identity
  inconsistencies.
- ts2hx recently gained effective module-request planning, explicit runtime
  profiles, side-effect import lowering, typed finally-completion planning, and
  typed package extern planning. Look for overlapping AST walks, source-order
  indices computed in multiple places, printer-owned semantic recovery,
  incomplete use of TypeChecker facts, or plans that exist but do not actually
  constrain emission.
- Compiler-internal top-level types and `FinallyCompletion` were introduced to
  carry outer return/break/continue through synthetic callbacks. Audit exactly-
  once finalizer execution, host-thrown-value preservation, nested target
  ownership, generated enum visibility, DCE, declarations, source maps, and
  whether local-completion output truly remains unchanged.
- The repository uses many executable manifests and scripts as evidence owners.
  Look for duplicated inventories, manually synchronized counts, generated
  artifacts that can drift, false independence between gates, and test names or
  compatibility prose broader than their assertions.
- Recent work closed every tracked issue quickly. Do not assume closure means
  the architecture is finished. Also do not manufacture work to keep a roadmap
  populated. Identify only findings with concrete evidence and practical value.

## Required audit areas

### 1. Semantic ownership and duplicated decisions

Map where each important fact is created, normalized, cached, and printed:

- public visibility, privacy, overloads, generics, inheritance, and DCE-retained
  API facts;
- null, undefined, optional, missing, and native-map absence;
- runtime values, side effects, type-only edges, declaration-only edges,
  import attributes, package/module identity, aliases, request order, and
  transitive initialization;
- names, scopes, temporaries, evaluation order, source spans, diagnostics, and
  output ownership;
- JSX/TSX intent and target capability;
- ts2hx functions, control targets, completion regions, effective requests,
  package externs, runtime profiles, and semantic-feature provenance.

For each fact, report whether ownership is single and explicit, intentionally
profile-specific, ambiguously split, or recomputed. Identify compatibility and
shadow paths that should now be removed, and call out any abstraction that is
premature or unused.

### 2. Correctness and language-semantics risks

Audit evaluation order, duplicated side effects, expression precedence,
constructor/static initialization, cycles, ESM request ordering, module
coalescing, import attributes, re-exports, exception/finally precedence,
switch/loop transfers, async boundaries, Haxe JS runtime metadata, DCE, and
source-map provenance. Prioritize silent wrong-code risks over output style.

For ts2hx, distinguish:

- supported behavior with executable differential evidence;
- supported behavior proved only by compilation or snapshots;
- strict rejection with transactional evidence;
- assisted output with explicit semantic loss;
- behavior implied by prose but not mechanically owned by the feature matrix.

### 3. Type safety and public surfaces

Search for explicit and inferred weak typing in Haxe APIs, generated user TS,
classic declarations, externs, helper layers, generated Haxe, runtime support,
and test harnesses. Review `Dynamic`, `untyped`, `cast`, `Any`, `any`, `unknown`,
raw type strings, catch-all index signatures, incomplete interfaces, generic
fallbacks, optional/nullish projections, and imported type/value identity.

Do not flag a narrow host exception or reflection boundary merely because it is
dynamic. Instead, verify that it is documented, contained, excluded from user
surfaces, and guarded by negative consumers. Identify weak boundaries that can
mask real regressions even when `tsc` passes.

### 4. Structure, complexity, duplication, and maintainability

Review modules, classes, functions, and test scripts for:

- repeated AST walks or classification logic;
- functions with too many responsibilities or hidden mutable state;
- bidirectional dependencies and circular ownership;
- inheritance that couples TS policy to classic implementation details;
- similar printers/tests that should share a semantic plan but not necessarily
  text generation;
- copied fixtures or manifests whose differences are accidental;
- dead branches, obsolete flags, transitional wrappers, stale TODOs, and
  commented historical behavior;
- abstractions whose name or API promises more than they guarantee;
- friendly documentation gaps around non-obvious invariants.

For each recommended extraction, name the exact duplicated decision and the
smallest seam. Do not recommend splitting a file solely to reduce line count.

### 5. Transactions, determinism, diagnostics, and compile-server state

Trace failure paths from planning through all printers and file publication.
Look for diagnostics that bypass rollback, writer creation before validation,
stale owned files, non-owned file deletion, nondeterministic map/set traversal,
process-global macro or TypeScript state, unstable hashes/IDs, output depending
on discovery order, source-position loss, and same-process contamination.

### 6. Performance and output quality

Identify algorithmic hot spots, repeated whole-program work, avoidable
quadratic scans, excessive maps/copies, large generated support surfaces,
unnecessary temporaries, completion-record allocations, redundant imports,
and tests that rebuild the same corpus more often than needed. Distinguish
measured regressions from plausible risks. Do not invent numeric budgets;
propose the smallest measurement owner and corpus first.

### 7. Test and evidence quality

Build a coverage/evidence map for runtime semantics, strict public typing,
negative diagnostics, source maps, output transactions, determinism, output
quality, supported TypeScript/Haxe/Node versions, package shapes, dual-output
examples, todoapp journeys, and ts2hx differentials. Find correlated tests
that are presented as independent or fixtures that assert generated shape
without exercising behavior.

Audit `package.json` scripts for duplicated or accidentally omitted gates.
Check compatibility reports, profile manifests, semantic counts, snapshot
inventories, and Bead/docs claims for drift. Recommend consolidation only when
it preserves failure locality and ownership.

### 8. Documentation, naming, and epistemic quality

Compare code comments, hxdoc, architecture docs, user docs, compatibility
reports, support matrices, and current behavior. Find:

- stale claims left behind by recently landed work;
- promises broader than fixtures or product boundaries;
- comments that explain an old implementation rather than the invariant;
- advanced metadata/macros/helpers without Why/What/How guidance;
- obscure or misleading names;
- documentation duplicated in enough places to drift;
- technically correct explanations that are unnecessarily difficult for a new
  contributor to understand.

Recommend concrete wording or ownership changes. Favor one authoritative
contract plus derived evidence over manually synchronized prose.

### 9. Compiler/ts2hx independence and long-term consolidation

Verify the actual dependency direction in code, build scripts, CI, fixtures,
and documentation. Determine whether any compiler gate accidentally relies on
ts2hx-generated source or whether ts2hx merely consumes the compiler. Assess
whether the Haxe bootstrap seam is a useful exercise of Genes without implying
that a Haxe rewrite is currently justified. List the prerequisites that would
make a future Haxe-authored ts2hx experiment scientifically useful and the
signals that should stop it.

### 10. Security and ecosystem boundaries

Inspect package/runtime module resolution, manifest-controlled resources,
path normalization, output paths, generated imports, subprocess execution,
temporary directories, archive/resource ownership, secret scanning, dependency
checks, and test-local packages. Separate compiler security risks from trusted
build-tool assumptions and name the threat model for each finding.

## Finding format

For every finding, use this compact structure:

1. **ID and title**
2. **Severity**: P0 correctness/security, P1 high-value architecture or evidence
   gap, P2 maintainability/performance/docs, or P3 optional polish
3. **Confidence**: high, medium, or low
4. **Evidence label and citations**
5. **Old/current behavior and practical consequence**
6. **Why existing tests or types do not already rule it out**
7. **Smallest generic correction**
8. **Exact focused fixture/command**
9. **Intentionally deferred scope and rollback point**

Do not inflate severity. P0 requires a plausible silent miscompile, public type
unsoundness with meaningful impact, data loss, transaction corruption, or a
security defect. Documentation style alone is not P0/P1. If a lead is clean,
say so and cite why; a useful audit should also identify stable architecture
that should not be disturbed.

## Required deliverable

Return a decision document with these sections:

1. **Executive verdict** — current product/architecture health, the strongest
   stable parts, the largest residual risks, and whether production compiler
   work should continue immediately or pause for evidence.
2. **Top findings** — at most ten P0/P1 findings, sorted by severity then
   confidence. State explicitly if fewer than ten are justified.
3. **Semantic ownership map** — one table showing fact, current owner,
   consumers, duplication/ambiguity, and recommended disposition.
4. **Detailed findings** — all justified P0–P3 items in the required format.
5. **Smell triage** — suspicious patterns investigated but found acceptable,
   plus taste-only ideas that should not become work.
6. **Type-safety threat model** — user surfaces, runtime boundaries, generated
   Haxe, declarations, externs, and negative-test gaps.
7. **Evidence and test audit** — what each major gate really proves, false
   independence/duplication, and missing or overbroad claims.
8. **Documentation audit** — exact stale/ambiguous passages and friendly
   replacement wording or a single-source-of-truth strategy.
9. **Performance/determinism/transaction audit** — observed defects versus
   experiments required, with measurement owners.
10. **Prioritized implementation plan** — separately reversible commits/Beads,
    dependencies, rollback points, focused gates, and final `yarn test:ci`.
11. **Do-not-change list** — architecture and evidence mechanisms that are
    working and would be harmed by cleanup for its own sake.
12. **Open experiments** — only unresolved facts, each with the smallest
    fixture and exact command.
13. **Oracle follow-up decision** — identify any finding that needs a second
    narrow GPT-5.6 architecture review before implementation. If none does,
    say that the repository team can proceed locally.

End with a short proposed Bead list containing only evidence-backed work. Use
clear titles, priorities, dependency relationships, acceptance criteria, and
the user-visible/compiler outcome. Do not create an issue merely because a
module is large or a different design is aesthetically attractive.

## Suggested review order

1. Read `AGENTS.md`, `docs/ARCHITECTURE.md`,
   `docs/ARCHITECTURE_ROADMAP.md`, `docs/OUTPUT_MODES.md`, toolchain and
   compatibility documentation, and `package.json`.
2. Trace `Generator` -> `Module` -> shared plans -> TS/classic/declaration
   emitters -> `OutputTransaction`.
3. Trace ts2hx `project.ts`/semantic plans -> `haxe/emit.ts` -> transactional
   publication -> snapshot/strict/differential owners.
4. Inspect the recent side-effect import, ordered request, finally completion,
   compiler-internal type, bootstrap, and typed package fixtures alongside
   their code.
5. Audit scripts/manifests/reports for evidence ownership and drift.
6. Only then rank findings and propose work.

The companion Repomix XML is the authoritative uploaded snapshot. If a needed
file is absent, name it explicitly and mark the conclusion **experiment
required** instead of filling the gap from memory.
