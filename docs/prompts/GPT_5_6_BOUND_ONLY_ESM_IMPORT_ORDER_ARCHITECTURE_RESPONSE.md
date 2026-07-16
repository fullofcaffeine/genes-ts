# GPT-5.6-sol review response: bound-only ESM request order

> Review metadata: OpenAI's local Codex client did not expose the requested
> `gpt-5.6-pro` model for this account, so this read-only consultation used
> `gpt-5.6-sol` with maximum reasoning against repository commit
> `ce7646c4f7a95f0e597886538d139d236c3db0c8`.
>
> Captured on 2026-07-15. Original response SHA-256:
> `65734079f61877da4e8aad5abe2ea52b77560873d0c17f3dfbca0aa5016bf00f`.
> The response is preserved below with only machine-local absolute links
> normalized to inline repository path citations.

# Architecture decision: bound-only ESM request order

Evidence labels:

- **Observed** — established by repository source, tests, or the read-only local probe.
- **Inference** — architectural conclusion from those facts.
- **Experiment required** — must be proven before advertising support.

## 1. Verdict and exact contract

**Decision:** split binding translation from runtime module-request semantics. Bound ESM initialization is a Genes-only J1 capability; standard Haxe must become an explicit capability boundary.

### Contract today

**Observed:** `modules.esm-bindings` is advertised as supported/J1 for an “ESM value/type binding and re-export subset,” while `modules.side-effect-import` separately owns ordered bare requests. `tools/ts2hx/src/semantic/ir.ts:193–207`

The implemented runtime contract is narrower:

- Every import with an `importClause` is recorded as `modules.esm-bindings`, regardless of whether TypeScript later emits it. `tools/ts2hx/src/haxe/emit.ts:3450–3460`
- Runtime-request planning starts only from files containing a bare import and expands through that converted dependency closure. A standalone bound-only project gets no plan. `tools/ts2hx/src/haxe/emit.ts:3019–3039`, `tools/ts2hx/src/haxe/emit.ts:3080–3099`
- Without an explicit side-effect edge, `DependencyPlan` deliberately reorders bound requests using the historical binding map. Both printers consume that resulting projection. `src/genes/DependencyPlan.hx:395–425`, `src/genes/es/ModuleEmitter.hx:18–41`, `src/genes/ts/TsModuleEmitter.hx:145–190`

Therefore, today `modules.esm-bindings` promises binding/type/value lowering only. It does **not** independently promise:

- retention of an unused emitted value import;
- import-declaration request order;
- first-occurrence request identity;
- runtime re-export liveness;
- cycle/TDZ parity.

Those properties are currently proven only when `modules.side-effect-import` puts the file into the bare-seeded ordered closure. The existing matrix wording is an overclaim.

### Contract after the proposed change

Keep the stable ID `modules.esm-bindings`, but narrow it to:

> Preserves the supported direct ESM binding surface—local names, aliases, type/value roles, and immutable value reads—after runtime-request planning. It does not own request retention/order, cycles, or runtime re-exports.

Add a stable row:

```text
modules.esm-runtime-requests
supported-with-helper / J1
```

Its exact contract:

> For a clean TypeScript project whose configured compiler emits ESM, preserve every supported emitted runtime module-request occurrence in emitted declaration order. Equal module identities, including supported attributes, coalesce at their first occurrence; later live bindings attach to that slot. TypeScript-elided and declaration-wide type-only imports create no runtime request. The guarantee applies to classic Genes ESM and genes-ts output, not the standard Haxe JavaScript generator.

The effective TypeScript emit—not parsed source shape and not Haxe DCE—decides whether an occurrence exists.

### Candidate disposition

| Candidate | Decision |
|---|---|
| 1. Conditional Genes carrier | **Modify and adopt.** Emit carriers for every effective request, but do not silently omit them with `#if`. Use a compiler-capability macro and explicit target profile. |
| 2. Target-polymorphic `touch(value)` | **Reject.** Argument evaluation can add real reads, getters, TDZ exposure, and cycle changes. |
| 3. Neutral per-module tokens | **Retain only inside Genes.** Existing tokens are useful typed identities, but are not a proven standard-Haxe ordering mechanism. Pure anchor reads are known to disappear under DCE. `tests/side-effect-import/README.md:18–24` |
| 4. Recover Haxe import syntax in Genes | **Reject for this design.** Genes receives typed expressions and module types; the repository has no evidence that typed macro APIs preserve unused source import declarations and their order. |
| 5. Split the support contract | **Adopt.** Binding shape and effective runtime requests are separate semantic features. |
| 6. Genes-only subset | **Adopt.** Ordered bound ESM requests are J1 with an explicit Genes capability. Standard Haxe fails cleanly when that capability is required. |

## 2. ECMAScript and TypeScript semantics

### ECMAScript contract

**Inference—language semantics:**

- Static `import` and runtime `export ... from` declarations contribute module requests before the importing module body runs.
- Their source order influences dependency traversal/evaluation order; they are not call-time statements.
- A module record evaluates once. Repeated equal requests can therefore coalesce at their first occurrence without duplicating execution.
- Imported bindings are live views of exporter bindings, not copied values.
- Cycles perform instantiation before evaluation and expose TDZ rules that cannot safely be replaced by eager helper calls or retention reads.

The repository’s semantic model already reflects the first-occurrence identity rule: request identity is external/internal target, path, and optional attribute; source position is provenance, not identity. `src/genes/DependencyPlan.hx:68–109` Equal requests coalesce in the shared projection, while later bindings attach to the first slot. `src/genes/DependencyPlan.hx:277–314`

### TypeScript emitter policy

TypeScript source is not itself the runtime oracle. The configured TypeScript emitter determines which ESM declarations survive.

**Observed—read-only local probe:** the installed compiler API reports TypeScript **6.0.3**. With the same source:

| Shape | `verbatimModuleSyntax: false` | `true` |
|---|---|---|
| unused named/default/namespace | elided | retained |
| `import {}` | elided | retained |
| `import { type T }` | elided | emitted as `import {}` |
| `import type { T }` | elided | elided |
| mixed used value + type | value part retained | value part retained |
| bare import | retained | retained |

This exposes two concrete bugs in the present syntax heuristic:

- `isRuntimeImport` always treats `import {}` as runtime, even when the configured compiler elides it.
- It treats an all-inline-type clause as non-runtime, even when verbatim emit produces `import {}`.
  `tools/ts2hx/src/haxe/emit.ts:2826–2836`

The version is also not pinned as tightly as documentation implies:

- Toolchain metadata says API bridge 6.0.2. `config/toolchains.json:19–24`
- The wrapper depends on `typescript@^6`, currently resolved to 6.0.3. `yarn.lock:763–766`, `yarn.lock:4243–4248`
- The API-lane gate checks only the major version. `scripts/test-typescript-api-lane.ts:4–9`

**Decision:** derive runtime requests from one in-memory `Program.emit` using the project’s effective options and an after-transform observer. Preserve all semantics-affecting options, override only filesystem/output controls, and require clean pre-emit TypeScript errors for this feature. Capture the post-elision import AST and assert it agrees with the in-memory printed JavaScript. Do not reimplement elision policy in ts2hx.

If the configured output for a source file is CommonJS rather than ESM—for example, a per-file NodeNext decision—the ESM feature fails closed.

## 3. Target matrix

`S/J1` means supported only through the Genes JS compiler capability. `Ø` means the configured TypeScript emitter creates no runtime request. `U` means strict failure.

| Effective shape | Original configured TS | Classic Genes | genes-ts | Standard Haxe JS |
|---|---:|---:|---:|---:|
| Declaration-wide `import type` | Ø | Ø; type projection only | Ø; `import type` if needed | Allowed for request aspect |
| Value-shaped import elided by TS | Ø | No carrier/request | No carrier/request | Allowed for request aspect |
| Acyclic converted named or aliased import, immutable export | ESM request | S/J1 | S/J1 | U |
| Acyclic converted default import of immutable export | ESM request | S/J1 after focused differential | S/J1 after focused differential | U |
| Namespace import with statically resolved immutable members | ESM request | S/J1 after focused differential | S/J1 after focused differential | U |
| Mixed type/value clause | Value portion creates request | S/J1 | S/J1 | U |
| `import {}` or inline-type clause emitted as `import {}` | ESM request | S/J1 using a target token | S/J1 using a target token | U |
| Unused emitted value import | ESM request retained | S/J1 using request-only slot if binding dies | Same | U |
| Bare package, owned relative resource, or acyclic converted bare import | ESM request | Existing S/J1 | Existing S/J1 | U |
| Bound package import | ESM request | U until package binding/runtime differential | U until same gate | U |
| Bound external-relative import or bound import attributes | ESM request | U | U | U |
| Runtime `export ... from` / `export * from` | ESM request + live export | U | U | U |
| Converted runtime cycle | Instantiation/evaluation cycle | U | U | U |
| Mutable exported/imported live binding | Live binding | U until a mutation differential passes | U until same gate | U |

“Allowed” in the first two standard-Haxe rows is not a general `modules.esm-bindings` parity claim. It means only that no ESM runtime-request capability is required. Any other feature-specific target restrictions still apply.

Both Genes profiles can share the positive rows because reachability includes `RuntimeSideEffect` in both profiles, and profile selection occurs only after the shared plan is built. `src/genes/Generator.hx:256–266`, `src/genes/Generator.hx:387–404`

## 4. Semantic ownership

The new model should remain small and immutable:

```ts
type RuntimeProfile = "genes-esm" | "standard-haxe-js";

type EmittedImportDisposition =
  | {
      kind: "runtime-request";
      ordinal: number;
      original: SourceSpan;
      emittedShape: "bare" | "named" | "default" | "namespace" | "empty";
      specifier: string;
      attributeType: string | null;
    }
  | {
      kind: "elided";
      original: SourceSpan;
      reason: "declaration-type-only" | "typescript-emit-elision";
    };

type RequestTarget =
  | { kind: "converted"; moduleId: string; anchor: string | null }
  | { kind: "package"; runtimeSpecifier: string }
  | { kind: "owned-relative"; runtimeSpecifier: string; sha256: string };

type EffectiveRequest = {
  occurrence: EmittedImportDisposition & { kind: "runtime-request" };
  target: RequestTarget;
};

type ProjectRequestPlan = {
  typescriptVersion: string;
  compilerOptionsHash: string;
  runtimeProfile: RuntimeProfile;
  bySourceFile: ReadonlyMap<string, readonly EffectiveRequest[]>;
  requiredCapabilities: readonly string[];
};
```

Ownership is:

1. **TypeScript bridge / ts2hx project prepass**

   - Own exact configured emit/elision and per-file ESM format.
   - Preserve original source spans using `ts.getOriginalNode`.
   - Require clean compiler diagnostics for this contract.
   - Record exact TypeScript engine version and options hash.

   The current bridge is deliberately centralized, making this an appropriate front-end responsibility. `tools/ts2hx/src/typescript-api.ts:3–10`, `tools/ts2hx/src/project.ts:32–78`

2. **ts2hx runtime project plan**

   - Resolve converted/package/manifest ownership.
   - Compute SCCs and reject unsupported cycles.
   - Choose a real binding anchor or deterministic target token.
   - Emit one ordered carrier per file with effective requests.
   - Own source-positioned diagnostics and manifest records.

3. **Generated Haxe**

   - Carries typed, ordered request evidence only.
   - Does not decide identity, coalescing, import elision, or output syntax.
   - Contains no runtime fallback.

4. **`DependencyPlanBuilder`**

   - Recognizes the exact typed marker owner/member.
   - Converts occurrences into ordered `RuntimeSideEffect` edges.
   - Does not traverse the anchor as an ordinary expression and therefore does not invent a binding read. `src/genes/DependencyPlanBuilder.hx:231–279`
   - Ordinary value expressions continue to contribute `RuntimeValue` bindings. `src/genes/DependencyPlanBuilder.hx:301–308`

5. **`DependencyPlan`**

   - Own request identity, first-occurrence coalescing, alias attachment, and type/runtime separation.
   - Preserve its legacy map-order branch for ordinary handwritten bound-only Haxe. Generated carriers create a side-effect edge and therefore bypass that branch without global output churn.

6. **Classic and TypeScript printers**

   - Remain syntax-only consumers of the shared projection.
   - No new order reconstruction or source parsing belongs in either printer.
   - Type-only requests remain excluded from classic runtime and emitted separately by genes-ts. `src/genes/DependencyPlan.hx:193–216`

7. **Transactions**

   - The complete project plan and all diagnostics must exist before writing.
   - Strict failure retains the previous tree. The current ts2hx transaction already enforces this boundary. `tools/ts2hx/src/haxe/emit.ts:3992–4085`

## 5. Generated Haxe contract

The Genes-profile carrier should be:

```haxe
@:keep
@:noCompletion
@:genes.compilerInternal
final __ts2hx_requests = {
  genes.internal.EsmRequestFact.internal(first);
  genes.internal.EsmRequestFact.internal(second);
  genes.internal.EsmRequestFact.internal(events);
  true;
};
```

`genes.internal.EsmRequestFact.internal/external` should be compiler-internal macros that:

1. check `js` and `genes.generator.active`;
2. issue `GENES-ESM-REQUEST-TARGET-001` when the custom generator is absent;
3. expand to the existing exact `SideEffectImportMarker`;
4. introduce no runtime implementation.

This follows the already-proven public `Imports.sideEffect` target guard. `src/genes/ts/Imports.hx:148–217`

There should be no `#if genes.generator.active` around the carrier. Conditional omission would make repro B silently lose a request under standard Haxe.

Other exact rules:

- `--runtime-profile genes-esm` emits carriers and records required capability `genes.esm-runtime-requests`.
- `--runtime-profile standard-haxe-js` rejects any effective request in strict mode before output.
- Compiling Genes-profile generated Haxe with standard Haxe fails during macro typing, not later with `ReferenceError`.
- Carrier name allocation remains `__ts2hx_requests`, then `__ts2hx_requests2`, etc. `tools/ts2hx/src/haxe/emit.ts:3558–3570`
- Binding-free converted targets retain the deterministic `__ts2hx_init_<10-hex>` name and numeric collision suffix. Their fields remain `@:keep`, `@:noCompletion`, and `@:genes.compilerInternal`. `tools/ts2hx/src/haxe/emit.ts:3545–3555`
- Targeted top-level initializers retain their focused `@:keep`; unrelated modules do not. `tools/ts2hx/src/haxe/emit.ts:3711–3719`
- Marker arguments are typed identities, not emitted value reads. The builder consumes them before ordinary traversal.
- Compiler-internal fields are filtered from classic JS, TS, `.d.ts`, and captured public surfaces. `src/genes/Module.hx:265–280`, `src/genes/PublicSurface.hx:308–333`
- Existing full-DCE evidence already proves order, duplicate coalescing, target retention, and no artifact leakage. `tests/side-effect-import/README.md:10–45`

Source maps should map output imports to generated Haxe carrier positions. Manifest schema v3 should separately retain original TypeScript spans, providing deterministic two-hop provenance rather than fabricating Haxe positions.

## 6. Initialization proof

### Repro A

**Current path:**

1. TypeScript emits `First`, `Second`, `State`.
2. The file has no bare-import ancestor, so ts2hx creates no request plan.
3. Generated Haxe imports the bindings, but its executable expression reads `events`, `second`, `first`.
4. Genes walks typed expressions in child order. `src/genes/util/TypeUtil.hx:377–422`
5. With no side-effect edge, `DependencyPlan` enters the legacy bound-only branch.
6. Both printers consume `State`, `Second`, `First`.
7. Node initializes second before first, producing the reported `second,first|1:2`.

The observed traces and carrier correction are recorded in the review prompt. `docs/prompts/GPT_5_6_BOUND_ONLY_ESM_IMPORT_ORDER_ARCHITECTURE.md:140–170`

**Proposed path:**

1. In-memory TS emit records `First`, `Second`, `State`.
2. The carrier creates three ordered request facts.
3. The builder creates request slots in that order before encountering ordinary value-use edges.
4. Ordinary bindings attach to the existing slots.
5. Both Genes printers emit `First`, `Second`, `State`.
6. Node evaluates once in dependency order and prints `first,second|2:1`.

No marker call or imported-value retention read reaches JavaScript.

**Standard Haxe:** strict translation reports `TS2HX-MODULES-ESM-RUNTIME-TARGET-001`. The locally observed monolithic standard-Haxe result is not retained as a feature contract.

### Repro B

With `verbatimModuleSyntax: true`:

1. TS emits `Unused`, `First`, `Second`, `State`.
2. `Unused` receives a request occurrence even though its local binding is never used.
3. Haxe full DCE may remove the unused binding edge, but the kept request slot remains.
4. Genes can emit a bare request for `Unused`; translated-source typing already validated the converted named export.
5. Both Genes modes print the four requests in order.
6. Node prints `unused,first,second|3:2`.

With `verbatimModuleSyntax: false`:

1. If the configured TS emit elides `Unused`, its disposition is recorded as elided.
2. No request carrier entry is generated.
3. Haxe DCE is no longer deciding TS semantics accidentally.
4. Both Genes profiles match the shorter TS request sequence.

Special cases:

- `import type` never creates a runtime request.
- An inline-only type import creates a request if the actual emitted JS contains `import {}`.
- An explicit `import {}` creates a request only if the actual emitted JS retains it.
- Default, namespace, aliases, and mixed clauses are handled according to emitted shape, not source heuristics.

## 7. Cycles, duplicates, and re-exports

### Duplicates

Equal identity means:

```text
external/internal kind + resolved module identity + supported attribute
```

Aliases and imported member names do not change request identity. Equal A/B/A occurrences produce A then B; later live A bindings attach to the first A slot. Attribute-different A requests remain distinct. This is already implemented and covered in both profiles. `src/genes/DependencyPlan.hx:301–375`, `scripts/test-side-effect-import-evidence.ts:192–245`

### Cycles

The first release should reject every converted runtime SCC, including bound cycles, using the existing stable diagnostic:

```text
TS2HX-MODULES-SIDE-EFFECT-IMPORT-CONVERTED-CYCLE-001
```

Its wording and fail-closed row should broaden from “binding-free cycle” to “converted runtime-request cycle.” Source position is the earliest request edge in the SCC by file/span order. Do not attempt a partial cycle subset until live bindings and TDZ are compared across the original TS, both Genes profiles, and any proposed standard lane.

### Runtime re-exports

All runtime `export ... from` and `export * from` remain unsupported. They must eventually join the same ordered declaration plan, but order alone is insufficient: current Haxe generation lowers value re-exports to `final` aliases, which are snapshots rather than general live exports. `tools/ts2hx/src/haxe/emit.ts:3596–3645`

Keep the stable diagnostic:

```text
TS2HX-MODULES-SIDE-EFFECT-IMPORT-REEXPORT-ORDER-001
```

Generalize it to any file with an effective runtime re-export, and attach it to the re-export declaration rather than an earlier bare import. Type-only re-exports remain allowed.

### Additional stable failures

Add:

```text
TS2HX-MODULES-ESM-BINDINGS-LIVE-001
TS2HX-MODULES-ESM-RUNTIME-PACKAGE-BOUND-001
TS2HX-MODULES-ESM-RUNTIME-MODULE-KIND-001
TS2HX-MODULES-ESM-RUNTIME-TARGET-001
```

Existing attribute, external-relative, unresolved, and unconverted-source diagnostics continue to own those boundaries. `tools/ts2hx/src/semantic/ir.ts:233–278`

## 8. Failure modes and threat model

| Threat | Decision/mitigation |
|---|---|
| Unused imports | Capture actual TS emit. Never infer retention from source shape or Haxe DCE. |
| `import {}` and inline type specifiers | Use post-transform AST; current heuristic is wrong in opposite directions under different options. |
| Default/named anchor reads | Typed markers are consumed before ordinary traversal and erased; they must never become runtime calls. |
| Namespace import | Use a deterministic target token because there may be no local Haxe binding. |
| Getter or proxy observation | Reject `touch(value)` and similar standard-Haxe fallbacks; they would evaluate arguments. |
| Live bindings | Restrict the first subset to immutable exports. Mutable exports/imports fail with the new live-binding diagnostic. |
| TDZ and cycles | Reject converted runtime SCCs until a dedicated instantiation differential passes. |
| Package externs | Existing evidence is compile-only, not runtime identity/loading evidence. `docs/ts2hx/LIMITATIONS.md:225–244` |
| TypeScript version drift | Record the actual compiler engine version and require exact equality in the API-lane gate. |
| Non-ESM NodeNext file | Detect actual emitted format and fail the ESM capability. |
| Compiler-server state | Do not rely on conditional parsing. The macro guard still needs a two-compilation isolation test because only an hxdoc claim exists today. `src/genes/CompilerInternal.hx:31–46` |
| Declaration/public leakage | Keep current late filtering and assert absence from JS, TS, `.d.ts`, public surface, and maps. |
| Source-map provenance | Preserve generated-Haxe mapping plus original TS span in manifest; do not invent cross-language positions. |
| Output churn | Enable all-file carriers only after a shadow plan shows which final imports intentionally change. Preserve the legacy branch for normal Haxe. |
| Partial/stale output | Finish planning before rendering; strict diagnostics publish nothing. Both ts2hx and Genes already have transactional owners. `src/genes/OutputTransaction.hx:10–31` |

## 9. Incremental implementation plan

Each item should be its own Bead and focused commit.

1. **Evidence baseline**

   Add standalone repro A/B to `semantic-diff`, initially asserting the known divergence and TS emitted request inventory. No behavior change.

2. **Exact TypeScript emitter lane**

   - Model wrapper version and compiler-engine version separately.
   - Pin the engine exactly.
   - Add in-memory effective-request extraction.
   - Record source import dispositions and shadow them into a diagnostic artifact without changing Haxe.

   Rollback: remove the shadow planner; existing emission is untouched.

3. **Capability and manifest schema**

   Add `--runtime-profile genes-esm|standard-haxe-js`, manifest schema v3, effective compiler facts, module-request dispositions, and `requiredCompilerCapabilities`.

   Standard profile fails transactionally on the first effective request.

4. **Guarded producer**

   Add the internal capability-checking macro and change ts2hx to produce carriers for every supported effective request, not just the bare-seeded closure.

   `DependencyPlan`, `DependencyPlanBuilder`, and both printers should need no ordering redesign: the existing marker expands into the existing `RuntimeSideEffect` path.

5. **Direct binding shapes**

   Enable named/alias first, then default, namespace, empty, mixed, and unused clauses only as their focused four-oracle tests pass. Keep package-bound, cycles, mutable bindings, attributes, and runtime re-exports fail-closed.

6. **Docs and compatibility**

   Update all matrices, manifest examples, fixture counts, and compatibility wording in the same commit as the corresponding tests.

7. **Full gate**

   Run `yarn test:ci`, which includes security, version, compatibility, compiler, acceptance, and ts2hx gates. `package.json:23–30`

No printer-specific patch should land unless a focused test proves the existing shared projection cannot express a required declaration.

## 10. Test matrix

Every positive runtime case needs:

| Oracle | Required invocation/result |
|---|---|
| Original TypeScript | Clean configured `Program` emit, Node ESM execution, captured effective requests |
| Classic Genes | `-lib genes-ts -dce full`, emitted ESM inspection, Node execution |
| genes-ts | `-lib genes-ts -D genes.ts -dce full`, generated TS checks in pinned lanes, Node execution |
| Standard Haxe | Expected translation/macro capability error for effective requests; positive compile/run only for request-free retained claims |

Required cases:

- repro A reverse value-use order;
- repro B unused import with `verbatimModuleSyntax` on/off;
- used and unused named/default/namespace imports;
- aliases and mixed type/value clauses;
- `import {}`, inline-only type specifiers, declaration-wide `import type`;
- duplicate A/B/A and attribute-distinct A/B/A;
- immutable direct bindings;
- mutable live-binding negative;
- converted two-node and self-cycle negatives;
- named and star runtime re-export negatives;
- local fake ESM package for named/default/namespace package imports;
- external-relative and attribute failures;
- full-DCE target and initializer retention;
- exact import order in both generated profiles;
- no marker, carrier, target-token, or compiler metadata leakage;
- `.d.ts`, public-surface, and source-map checks;
- unchanged prior tree after every strict failure;
- deterministic output and manifest hashes;
- exact TypeScript engine assertion plus generated-output lanes;
- compile-server capability isolation.

The existing semantic test is a good base because it already runs original TS, classic Genes, and genes-ts, uses full DCE, checks request order, duplicate coalescing, and leakage. `tools/ts2hx/src/test-semantic-diff.ts:445–585` The current standard snapshot smoke is insufficient for semantic retention because it does not use `-dce full` and does not compare against the original TS oracle. `tools/ts2hx/src/test-snapshots.ts:358–380`

## 11. Exact matrix, documentation, and compatibility changes

### Semantic counts

Current documented inventory:

- 18 feature rows;
- 16 supported;
- 2 unsupported;
- 9 named fail-closed cases.
  `docs/ts2hx/LIMITATIONS.md:52–77`

After this decision:

- **19 feature rows**
- **17 supported**
- **2 unsupported**
- **13 named fail-closed cases**

Changes:

1. Narrow `modules.esm-bindings`, retaining supported/J1.
2. Add `modules.esm-runtime-requests`, helper/J1.
3. Retain `modules.side-effect-import`, helper/J1, as the bare-import/helper/resource-staging surface.
4. Broaden the existing cycle and re-export failure variants without changing their IDs.
5. Add four failures: live binding, package-bound runtime, non-ESM module format, and standard target capability.

The evidence-only fixtures become:

- `semantic-diff`: 17 exercised supported contracts, still three runtime oracles;
- `semantic-unsupported`: 13 feature-specific failures;
- standard-Haxe capability rejection plus a separate request-free full-DCE positive lane.

### Manifest and CLI

Manifest schema becomes version 3 and adds:

```json
{
  "targetProfile": "genes-esm",
  "compiler": {
    "typescriptBridgePackage": "6.0.2",
    "typescriptEngine": "6.0.3",
    "optionsHash": "..."
  },
  "requiredCompilerCapabilities": [
    "genes.esm-runtime-requests"
  ],
  "moduleRequests": [
    {
      "source": "...",
      "disposition": "runtime-request | type-only | elided",
      "ordinal": 0,
      "specifier": "./first.js"
    }
  ]
}
```

The existing `runtimeModules` field remains reserved for hash-owned staged resources. Current schema v2 has no target-capability field. `tools/ts2hx/src/haxe/emit.ts:83–95`, `tools/ts2hx/src/haxe/emit.ts:4060–4069`

### Fixture inventory

Keep the snapshot inventory at **20 projects / 48 generated files** by putting A/B in `semantic-diff`, not the shape snapshots. `docs/ts2hx/USAGE.md:147–181`

**Observed—read-only current-config audit:** TypeScript 6.0.3 emits runtime module requests in 11 of the 20 snapshot projects; nine are request-free. Of those nine, `react-types` remains compile-only for its independent JSX-marker boundary. Therefore the replacement standard-Haxe inventory should be:

- **11 projects require Genes ESM capability;**
- **9 projects retain standard-Haxe compile smoke;**
- **8 of those retain standard-Haxe execution smoke;**
- **1 (`react-types`) remains compile-only.**

This count must become a tracked manifest-derived assertion before documentation claims it. Remove “Most fixtures compile and execute through standard Haxe JS”; current docs make that broad claim without a full-DCE semantic comparison. `docs/ts2hx/LIMITATIONS.md:260–278`

### Required documentation edits

- `docs/ARCHITECTURE.md`: replace the claim that unrelated bound-only translations retain standard-Haxe behavior with the complete effective-request plan and explicit target boundary. The current claim is at `docs/ARCHITECTURE.md:254–263`.
- `docs/ts2hx/LIMITATIONS.md`: split the two feature rows, document TypeScript emit ownership, update 17/2/13 counts, and replace aggregate standard claims.
- `docs/ts2hx/USAGE.md`: document `--runtime-profile`, schema v3, exact compiler engine, and the 11/9/8 fixture inventory.
- `docs/ts2hx/PORTABILITY.md`: clarify that J1 may require a named custom-generator capability; it does not imply standard Haxe JS. Current side-effect text already points in that direction. `docs/ts2hx/PORTABILITY.md:20–39`
- `docs/OUTPUT_MODES.md` and `docs/typescript-target/IMPORTS.md`: state that ordered requests are shared by both Genes modes and fail cleanly under standard Haxe. The public bare helper already documents this boundary. `docs/typescript-target/IMPORTS.md:143–158`
- `docs/COMPATIBILITY_REPORT.md`: say the three-runtime differential proves only the named Genes/original contracts; standard target rejection is a capability test, not a fourth runtime parity result. Snapshots remain shape evidence only. `docs/COMPATIBILITY_REPORT.md:99–130`
- Fix the current internal documentation mismatch where one evidence table says 15 semantic contracts while the later matrix says 16. `docs/ts2hx/LIMITATIONS.md:31–40`

## 12. Open experiments

Only these facts remain unproven.

1. **Blocking: exact Program-emit extraction**

   Fixture: one file containing unused named/default/namespace, `import {}`, inline type-only, declaration type-only, mixed, aliases, and bare import; configs with verbatim on/off and ESM/CJS NodeNext files.

   Proposed gate:

   ```bash
   yarn --cwd tools/ts2hx build
   node tools/ts2hx/dist/test-esm-request-plan.js
   ```

   It must assert original-node provenance, post-transform request AST, printed-JS agreement, and exact TypeScript engine version.

2. **Blocking per shape: default, namespace, mixed, and package-bound behavior**

   Extend `semantic-diff` with a local fake ESM package and immutable converted exports.

   ```bash
   yarn --cwd tools/ts2hx test:semantic-diff
   ```

   Do not promote package-bound support until original TS, both Genes modes, and emitted import shape agree.

3. **Blocking for the private guard: macro timing and compile-server isolation**

   Add a script that starts one Haxe server, performs a Genes build containing the internal macro, then a `genes.disable` build using the same server. The second build must report the target diagnostic and publish no output.

   ```bash
   node scripts/dist/test-generator-capability-isolation.js
   ```

   No raw `#if genes.generator.active` design should be adopted from the current hxdoc claim alone.

4. **Blocking for live bindings**

   Fixture: `export let value`, importer reads before and after exporter mutation; include direct, aliased, namespace, and re-export forms.

   Until all three runtime oracles agree, retain `TS2HX-MODULES-ESM-BINDINGS-LIVE-001`.

5. **Blocking for cycles/re-exports**

   Use a two-module cycle with an early safe function binding, a TDZ-triggering binding, named re-export, and star re-export. Compare initialization traces and thrown error class/message boundaries. Until then, fail the whole converted SCC and every runtime re-export.

6. **Optional future standard-Haxe promotion**

   Start with one used immutable converted import and then one unused emitted import, both under `-dce full`. Compare original TS, standard Haxe, classic Genes, and genes-ts.

   No standard-Haxe ESM-request subset should be advertised before that four-oracle gate. A single-request exception is not assumed by this decision.

7. **Source-map provenance**

   Assert generated JS/TS import positions map to carrier calls and manifest request entries retain original TS spans. This is necessary before claiming end-to-end diagnostic provenance, but it does not block the runtime-order architecture.

No files were modified. All repository inspection and TypeScript probes were read-only and in-memory.
