# Compilation-server equivalence fixture

This fixture is copied into disposable project roots by
`yarn test:compiler-server`. The test sends both projects and every profile
transition through one repository-owned Haxe server, while an isolated Haxe
process builds the same request into a sibling `cold` tree.

The two projects deliberately reuse the same Haxe module and field names. Their
types, directives, runtime markers, and public surfaces differ, so a
process-persistent cache keyed only by a short name or source span becomes an
exact cold/warm tree mismatch.

The harness gives each project a private, behavior-neutral define. Haxe 4.3.7
selects its own typed-module cache by compilation signature rather than
classpath identity, so without that define Haxe can return Project A's
same-named typed tree before Genes executes Project B's generator. The define
separates only Haxe's native project caches; both projects still share the same
server process and therefore the same Genes `@:persistent` macro lifetime.

The focused owner covers:

- TypeScript, TSX, classic MJS, and classic declarations;
- repeated requests and changed output roots;
- source edits, deleted/restored modules, module directives, module functions,
  DCE/library roots, occurrence-local generic extern witnesses, exact React
  state initialization types, and import attributes;
- a successful build followed by structured-diagnostic and raw-value
  post-staging failures in TS and classic declaration profiles, then recovery;
- active-Genes then `genes.disable` capability isolation;
- source maps, strict TypeScript consumers, runtime transcripts, manifests,
  staging/sentinel cleanup, bounded clients, unrelated listeners, signal
  cleanup, and exact owned-process death.

The generated `.tmp` directory is disposable and intentionally ignored. Do not
turn it into checked-in expected output; the cold build is the executable
oracle for the warm build.

Run the complete stable owner with `yarn test:compiler-server`. Use
`yarn test:compiler-server:rollback` when changing exception handling,
transaction cleanup, or the Haxe preview lane: it executes only the TS/classic
post-staging failure and recovery contract.

## Macro-state checkpoint

The fixture was extended after the architecture checkpoint because the earlier
generic call used only `@:ts.explicitTypeArguments`. That path derives a type
from the current callee and never consulted the lower-level
`TypeArguments.call(...)` registry that the checkpoint had identified as
suspicious.

The reduced probe now compiles one exact call position as `String`, then `Int`,
then `String` again. Before the correction, the first stable warm request
failed because its cached carrier could not find the witness in the generator's
macro context. The fix removed that static registry: inert typed facts now live
on the exact carrier occurrence and both emitters erase them. Copied source
positions can consequently carry different facts safely, and the server does
not need a compiler-wide session or persistent typed cache.

The checkpoint classifications are:

| Owner | Executable evidence | Result |
|---|---|---|
| `ExplicitTypeArguments` | Same absolute call site with String → Int → String, plus two copied occurrences at one source span | **Defect reproduced and fixed.** Facts are occurrence-local in the typed tree; no mutable macro registry remains. |
| Generator callbacks and `@:genes.generate` membership | Identical repeats, edit/delete/restore, profile changes, and a final return to the first tree | **No observable stale output.** Current-generation metadata continues to select the correct module inventory. |
| `CompilerInternal.GENERATOR_ACTIVE_DEFINE` | Active Genes requests followed by `genes.disable`, then a successful request | **Request-scoped in the supported lane.** The disabled request fails at the authored carrier and publishes nothing. |
| `PublicSurface` | Application/library DCE changes and two same-named projects with different public field types | **Explicit reset is effective.** Strict consumers observe only the current project's surface. |
| `SignatureCache` | Same-named projects with String versus Int fields and generic arguments | **Explicit reset is effective.** Generated implementation and classic declarations equal isolated cold builds. |
| `ModuleDirectivePlan` | Edited/restored directives and distinct same-named project prologues | **Explicit reset is effective.** Directive spelling/order follows the current request. |
| `TypeUtil.registerType` / `bootType` | Intrinsic-first and direct-import-first field-level `@:jsRequire` edits in `yarn test:genes-ts:source-inline-server`, plus the complete server matrix | **Defect reproduced and fixed.** The first `Generator.use()` in every request refreshes that compilation's declarations; both edit orders restore byte-identical trees on Haxe 4.3.7. Haxe 5 preview still exposes the separate advisory DCE variance described below. |
| Generator output path and sentinel fields | Changed roots, TS/classic extensions, staged failure/recovery, manifest and sentinel checks | **Current request wins.** Prior owners remain intact and private debris is removed. |
| Raw generation throws | TS and classic declaration builds throw a plain Haxe string after every emitter has staged its files, in cold and warm processes | **Wrapped by the supported Haxe macro runtime.** The same `haxe.Exception` rollback boundary preserves the prior tree and removes the stage/sentinel before a corrected request. |

On Haxe `5.0.0-preview.1`, exact preview output still fails before the longer
matrix: after the compiler's casting stage, cold and warm `genes.Register` are
equivalent, but after DCE the generic `js.lib.Object.defineProperty` monomorph
is unresolved in the cold tree and resolved to `{}` in the warm tree. Genes
therefore prints the warm request's checked `unsafeCast<{}>` and the cold
request prints the direct value. This is a visible preview typed-AST variance,
not a TypeUtil owner mismatch or a relaxed file allowlist. Preview remains
advisory; stable Haxe 4.3.7 remains the blocking lifecycle contract.

`yarn test:compiler-server:rollback` isolates the publication boundary from
that known variance. On preview it compares the corrected cold build with its
own cold baseline and the corrected warm build with its own warm baseline; it
does not pretend those two different typed trees are byte-identical. Stable
Haxe continues to require cold/warm identity in both the focused rollback probe
and the complete server matrix.
