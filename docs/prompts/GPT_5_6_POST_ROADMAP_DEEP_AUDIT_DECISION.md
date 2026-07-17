# Post-roadmap deep-audit decision

This document records how the 2026-07-17 GPT-5.6 Pro audit was checked against
the repository and converted into work. It is intentionally shorter than the
review transcript: future contributors need the evidence, disposition, and
boundary that guide implementation, not a second copy of every paragraph.

The reviewed production baseline was
`929ea93d9dbeb57098d9ffdc301fce524bcccfa8`. The response was read as a set of
hypotheses. A severity label from an oracle is not evidence by itself.

## Practical outcome

The audit found several real ownership gaps, but it did not justify a compiler
rewrite or a broad emitter split. Work should continue through small fixtures
and reversible fixes. The next compiler/ts2hx release must not claim closure
until the four P0 Beads below are either fixed or falsified by executable
evidence.

The strongest architecture remains intact:

- the typed Haxe AST is authoritative;
- small immutable plans own only facts shared by multiple consumers;
- TypeScript, classic JavaScript, and declaration printers choose their own
  syntax from those facts;
- output transactions preserve unrelated files and publish source maps with
  their source files;
- ts2hx remains downstream migration tooling and cannot become the compiler's
  correctness authority;
- dynamic host behavior stays behind narrow, documented runtime boundaries;
- large emitters are not split merely to reduce line counts.

## Evidence convention

- **Observed** means the defect or gap is present directly in the source.
- **Inference** means the source establishes a dangerous path, but a focused
  runtime/compiler fixture still has to prove that the path is reachable.
- **Experiment required** means no production change is authorized until the
  named experiment establishes the behavior and threat model.

## Validated findings and Beads

| Audit finding | Local disposition | Bead |
| --- | --- | --- |
| GRA-001: filename-only `StdTypes.ts.map` retirement | **Observed P0.** `OutputTransaction.retire` bypasses prior manifest ownership, and TS generation calls it unconditionally. Add the unowned sentinel before changing cleanup. | `genes-gl2` |
| GRA-002: lossy transaction scope | **Reproduced and remediated P0.** The focused baseline test showed `entry@one.ts` consuming the lossy `entry_one` v1 scope. Manifest v2 now records the exact basename plus extension, uses a readable full-digest scope, rejects owner mismatches before publication, and preserves ambiguous v1 ownership rather than guessing. | `genes-552` |
| GRA-003: ts2hx source namespace collision | **Reproduced and remediated P0.** The baseline focused test showed `foo-bar.ts` and `foo_bar.ts` both reporting success while staging `FooBar.hx`. One immutable pre-emission plan now validates the base package, directory segments, root containment, module FQN, and portable output identity. All source/import/re-export/runtime-anchor/resource/extern consumers reuse it; every collider receives a source-positioned error in strict and assisted modes, with no publication. | `genes-3a5` |
| GRA-004: import binding form/declaration identity collapse | **Observed omission, inferred consequence.** Equality and accessor lookup omit binding form and original declaration identity. The exact Haxe/package pair must reproduce before severity is final. If it does, a narrow architecture review is mandatory before the shared identity changes. | `genes-ntz` |
| GRA-005: malformed handwritten import attributes | **Reproduced and remediated P1.** The baseline accepted a two-argument annotation and published output because malformed presence collapsed to `null`. Shared dependency planning now distinguishes absence from presence and rejects wrong arity, computed values, and empty literals with stable source-positioned diagnostics. The paired TS/classic gate seeds prior output and proves each failure publishes no module, declaration, map, support file, or manifest; the valid handwritten JSON request still executes in both profiles. | `genes-3vd` |
| GRA-006: external diagnostics after ts2hx commit | **Reproduced and remediated P1.** A successful baseline translation replaced the prior Haxe tree before an invalid external target produced exit 2. External bytes are now staged first and installed while the old tree backup remains available; staging/install failures preserve prior output and leave no transaction debris. The documented guarantee covers reported process failures, not crash-atomicity across filesystems. | `genes-ipp` |
| GRA-007: no-clean ts2hx leaves stale owned Haxe | **Reproduced and remediated P1.** Removing a TypeScript root left its manifest-owned Haxe in a successful no-clean tree. Publication now validates the complete prior schema-v3 ownership envelope, removes only stale `plannedFiles` inside the private stage, preserves colocated assets and handwritten Haxe, and rejects malformed or escaping ownership before replacing prior output. | `genes-qfn` |
| GRA-008: bound-only request order from `Map` | **Experiment/decision, downgraded to P2.** The branch is explicitly documented compatibility for ordinary Haxe imports, whose textual import order is not itself an ESM runtime contract. ts2hx effective request carriers already create explicit observable request edges. Do not call this a miscompile until a supported-source oracle defines a contradictory order. | `genes-9n4` |
| GRA-009: public-surface audit enrollment | **Observed P1 evidence gap.** TypeChecker traversal is strong after enrollment, but profile callers supply manual path lists. Fix enrollment rather than weakening or replacing the audit. | `genes-7dt` |
| GRA-010: symlink/reparse containment | **Experiment required.** Lexical containment is visible; pinned Haxe filesystem behavior and the relevant trusted-workspace threat model are not. | `genes-rby` |
| GRA-011: dependency projection scaling | **Experiment required, P2.** repeated linear scans are visible, but no material compiler cost is established. Preserve ordered arrays even if lookup maps are later justified. | `genes-cju` |
| Deep nullish alias cutoff | **Experiment required, P2.** the defensive depth bound exists, but Haxe may normalize legal aliases before it becomes observable. | `genes-88n` |

## Why the bound-order finding was narrowed

`DependencyPlan.projectImplementation` builds edge-ordered request arrays, but
uses a historical bound-only compatibility projection when no explicit runtime
side-effect edge exists. Its nearby hxdoc explains the distinction:

- a direct Haxe import is a compile-time name lookup, not a source-level ESM
  declaration whose text promises runtime request order;
- an explicit side-effect request or a ts2hx request carrier is an observable
  runtime request and therefore uses semantic edge order;
- existing bound-only output was deliberately kept byte-stable while the
  ordered request architecture landed.

The audit correctly noticed that the stronger architecture prose could be read
as contradicting this exception. It did not prove that Haxe source import text
is the missing semantic authority. The focused decision must compare standard
Haxe behavior, classic Genes, genes-ts, and ts2hx carriers before either keeping
or removing the compatibility path.

## Implementation order

1. Protect unowned legacy output and give each compiler entrypoint an exact,
   collision-resistant transaction identity.
2. **Landed:** keep the project-wide ts2hx source namespace plan ahead of every
   spelling and publication consumer; later stale-output ownership may rely on
   its unique `plannedFiles` identities.
3. Reproduce the import-binding collision. If reachable, prepare the narrow
   GPT review requested by `genes-ntz`, then implement one canonical identity
   without merging module-request and binding equality.
4. Fail closed on malformed import-attribute metadata.
5. **Landed:** coordinate the optional external diagnostics artifact with
   ts2hx output publication, then consume recognized prior `plannedFiles` for
   safe no-clean stale removal.
6. Enroll all compiler-owned public modules in the existing semantic type
   audit or require an explicit support/runtime classification.
7. Resolve the three experiments before creating performance, symlink, or deep
   nullish production patches.

Every production step starts with the smallest failing fixture, documents the
old and new observable behavior, runs its focused owner, and then runs the full
`yarn test:ci` gate before downstream use.

## Required identity boundaries

The fixes must not conflate these independent questions:

- **Output owner identity:** which configured compiler entrypoint may publish
  or stale-delete a path.
- **Source module identity:** which TypeScript file becomes which Haxe package,
  module FQN, and output path.
- **ESM request identity:** which module specifier/attribute combination is
  evaluated and in what explicit runtime-request order.
- **Import binding identity:** which named/default/namespace export supplies a
  particular Haxe declaration and collision-resolved local identifier.

One module request can satisfy several bindings. Two bindings must never be
merged merely because they request the same module or share a simple name.

## Documentation contract during remediation

Until the fixes land, documentation must not overclaim:

- filename resemblance is not compiler ownership;
- ts2hx source identities are certified by the pre-emission namespace plan;
  invalid or colliding packages/modules fail before runtime or text planning;
- the embedded `ts2hx-manifest.json` is part of the output-tree transaction,
  while optional external diagnostics currently have a separate failure
  boundary;
- default no-clean translation retires only files affirmed by the prior
  schema-v3 ownership inventory and preserves every unowned path;
- semantic public-surface guarantees apply to enrolled files, and enrollment
  itself is being made executable.

Prefer correcting behavior over weakening the intended ownership promises.

## Do-not-change boundary

Do not use these findings to justify:

- a universal IR, Reflaxe port, or second compiler engine;
- a whole-directory swap for compiler output that may share user assets;
- merging TypeScript and classic printer syntax;
- moving public-surface, nullish, name, temporary, JSX, completion, or request
  facts back into mutable printer-local inference;
- weakening unsupported ts2hx shapes to `Dynamic` or generated `any`;
- removing the temporary completion shadow before its staged migration is
  complete;
- a Haxe rewrite of ts2hx before an independent bootstrap/evidence design;
- performance changes without measurements or platform-specific filesystem
  hardening without reproduction.

## Narrow follow-up oracle rule

Only `genes-ntz` currently requires a second GPT architecture review. First
commit the failing same-specifier/same-name, different-binding-form fixture and
capture the generated wrong output. The review should decide where canonical
binding identity is created and how it reaches accessors while keeping request
coalescing, runtime/type/declaration reachability, aliases, and both printers
consistent. The other confirmed findings have narrow local owners and should
proceed through fixtures rather than another broad consultation.
