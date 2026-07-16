# Output modes (genes-ts)

genes-ts supports **two output modes** within the same library (`-lib genes-ts`).

The mode is selected by the presence of `-D genes.ts`.

## Readiness by surface

The two modes are first-class compiler paths, but their evidence is not
identical:

| Surface | Current disposition | Tested boundary |
| --- | --- | --- |
| TypeScript implementation source | Bounded-ready | Strict ESM/NodeNext and React profiles represented by repository fixtures, with closed-interface negative consumers and runtime checks. |
| Classic ESM JavaScript runtime | Bounded-ready and the more mature runtime path | The blocking classic assertion suite on the pinned Haxe/Node profile. |
| Classic `.d.ts` | Bounded and improving | Precise `Null<T>`, a semantic exported-surface audit, and strict external consumers. Complex package shapes remain separate work. |
| Same-source dual output | Bounded-ready for the checked corpora; experimental as a general guarantee | `yarn test:dual-output` covers the target-neutral core, `yarn test:genes-ts:tsx` owns focused JSX semantics, and `yarn test:examples` runs the minimal and fullstack applications through both profiles. |
| Reusable-library profile | Bounded-ready for explicitly marked classes | `yarn test:library-profile` proves inactive/default DCE, retained TS and classic implementations, matched strict `.d.ts`, signature-reachable classes, and generic abstract helper ownership. |

Passing `tsc` proves that the exercised generated program is accepted. It does
not by itself prove that every exported type is complete or precise. The
negative and semantic export gates are therefore separate product evidence.

## 1) TypeScript source output (recommended for “Haxe → TS” migration)

Enable with:

```hxml
-D genes.ts
```

Characteristics:
- Emits split ESM **TypeScript source** (`.ts` / `.tsx`) that is intended to be compiled by `tsc` (or a bundler).
- Good fit when you want to:
  - migrate a codebase to TypeScript over time
  - interop deeply with TS/React tooling
  - diff/review generated output as readable TS

Related knobs:
- `-D genes.ts.no_extension` for bundler workflows (extensionless imports).
- `-D genes.ts.no_null_union` for `strictNullChecks: false` projects (erase `Null<T>` unions).
- `-D genes.ts.dynamic_unknown` to map `Dynamic -> unknown` (opt-in stricter interop).
- `-D genes.ts.minimal_runtime` for a “TS-first / no-reflection” profile.

React authoring:
- `genes.react.JSX.jsx(...)` + inline markup emit TSX or typed createElement
  source in this mode (see `docs/typescript-target/REACT_HXX.md`).
- Inline markup is default-on; the same shared JSX intent can also lower in
  classic mode when its parser rewrite is explicitly enabled.

Typing:
- See `docs/typescript-target/TYPING_POLICY.md`.

## 2) Classic Genes JS output (recommended for Haxe-first projects)

Default when `-D genes.ts` is **not** set.

Characteristics:
- Emits split ESM **JavaScript** (`.js`).
- Can emit `.d.ts` alongside `.js` via `-D dts`.
- Does **not** require a TS compilation step (useful when TS compilation cost/complexity is a net negative).

Related knobs:
- `-D genes.no_extension` for extensionless imports in JS output.

### Performance-oriented ES6 profile

The performance-oriented ES6 profile is the explicit classic Genes path for
projects that want the same Haxe source to run without a TypeScript compilation
step:

```hxml
-lib genes-ts
-cp src
--main my.app.Main
-js dist/index.js
-D dts
-D js-es=6
```

This profile intentionally omits `-D genes.ts`. It should reuse regular Genes'
split ESM JavaScript behavior, with `../genes-vanilla` as a read-only reference
when compiler architecture questions arise. Any fixes still land in this repo,
not in `../genes-vanilla`.

Use this profile when runtime simplicity or compile latency matters more than a
reviewable generated TypeScript source tree. Do not weaken TypeScript output to
serve this profile: TS mode remains the default for projects whose generated TS
is a product surface, while ES6-specific work should have its own fixture or
smoke gate.

The standing classic gate is `yarn test`. The smaller authoritative side-by-side
gate is `yarn test:dual-output`; its source, expected semantic transcript,
bounded shape snapshot, vanilla baseline, and profile ownership manifest live
under `tests/output-modes/`. That command also runs `yarn test:output-quality`:
two clean compiler trees must hash identically after documented source-map path
normalization, representative TS/classic tokens and stack stages map exactly,
and checked-in module/temp/import plus byte/token budgets must hold.

The checked-in application profiles provide a separate integration layer.
`yarn test:examples` requires every immediate `examples/` directory to appear
in `examples/profiles.json`, emits the same source as `ts-strict` and
`classic-esm`, consumes classic declarations on TS 5/6/7, and runs both todoapp
servers through the same API checks. `yarn test:examples --playwright` repeats
the same browser journeys against TS-compiled and direct-classic runtimes.

### Reusable-library profile

Application output and library output have different DCE contracts. An
application may remove a public method that no compiled Haxe expression calls;
a JavaScript package cannot, because its callers live outside the Haxe build.
Use the explicit library overlay for package entry points:

```haxe
/** Public package facade retained only by the reusable-library profile. */
@:genes.library
class PublicApi {
  public function new() {}
  public function greet(name:String):String return 'Hello $name';
}
```

```hxml
-D genes.library
-D dts # required for classic JS; omit only when also using -D genes.ts
--macro include('my.library') # ensure otherwise-unreferenced API modules are typed
```

The marker is intentionally inert without `-D genes.library`. When active, the
compiler captures the selected class before DCE, retains its complete public
runtime surface, recursively retains concrete types named by that surface, and
adds a root ESM re-export. Private helpers remain private and survive only when
a retained method body calls them. Abstract receiver helpers own their required
method generics; true abstract statics do not acquire meaningless owner type
parameters.

In classic mode, the define fails before output unless `-D dts` is present,
because this profile promises matched JavaScript and declarations. In
TypeScript mode, the emitted implementation source is itself the typed public
surface. `yarn test:library-profile` builds the same inert source as default
classic, library classic, and library TypeScript, type-checks both surfaces on
TS 5/6/7, and executes both retained runtimes.

## Picking a mode

- If your goal is “Haxe is a better language on top of TS, and we may port to TS later” → use **TypeScript output** (`-D genes.ts`).
- If your goal is “we keep writing Haxe, but want modern ESM output plus
  reviewed declarations” → use **classic Genes JS output** (omit
  `-D genes.ts`, keep `-D dts`). The JS runtime and declaration readiness are
  intentionally assessed separately.

## TypeScript-aware helpers that still run as ES6

The two modes are not meant to force two Haxe codebases. Ordinary Haxe that
does not use TS-specific helper types should compile through either profile,
and helper abstractions should declare an honest lowering or target guard.
`Undefinable`, immediate `Unknown` narrowing, and ordinary Haxe runtime seams
now have one authoritative paired corpus. That evidence remains bounded. JSX
is owned by a separate same-source React differential; complex package shapes
and unrepresented language constructs are not implied by either transcript.

For JS/TS ecosystem projects, the recommended authoring model is **TS-minded Haxe**. Write normal Haxe, but keep the TypeScript boundary contracts in mind: use Haxe typedefs, enums, abstracts, externs, and focused `genes.ts` helpers where they make DOM, Node, npm, or generated declaration shapes more precise.

For TypeScript-specific ecosystem concepts, prefer small Haxe helper types instead of raw emitted strings.

Current examples:

| Helper | Why it exists | TS output idea | JS output idea |
| --- | --- | --- | --- |
| `genes.ts.Undefinable<T>` | Many TS APIs use `undefined` for “not provided” and reject `null`. Haxe `Null<T>` alone cannot express that contract. | `T | undefined` | Runtime value is `T` or real `undefined`. |
| `genes.ts.Unknown` | Raw JSON, plugin payloads, host APIs, and caught JS values may be untrusted. TS `unknown` is safer than `any` because users must narrow/decode before use. | `unknown` | A contained Haxe abstract over the runtime value. |
| `genes.ts.UnknownNarrow`, `UnknownRecord`, `UnknownArray` | Haxe can run JS runtime checks, but it cannot represent TypeScript's control-flow proof that an `unknown` is now a string, record, or array. | Guarded helpers over `unknown`, `Readonly<Record<string, unknown>>`, and `readonly unknown[]`. | The same `typeof`, `Array.isArray`, `Object.keys`, and own-property checks as plain ES6. |
| `genes.ts.Imports` | Existing npm/TS/TSX modules need value, type, default, named, namespace, attributed, and binding-free side-effect imports. Import syntax should be generated consistently instead of scattered as strings. | Idiomatic ESM imports and type imports. | Equivalent ESM imports in classic JS output where applicable. |

A binding-free request is authored as a direct class initializer statement:

```haxe
import genes.ts.Imports;

class Main {
  static function __init__():Void {
    Imports.sideEffect("./runtime/setup.js");
    Imports.sideEffectWith("./runtime/config.json", "json");
  }
}
```

Both Genes profiles emit ordered bare ESM declarations; no fake imported value
or declaration member is created. Specifiers and optional `type` attributes
must be non-empty literals, and calls must be direct outer statements of
`static __init__`. Standard Haxe (`genes.disable`) and non-JS targets fail with
`GENES-SIDE-EFFECT-IMPORT-TARGET-001` because silently erasing required module
initialization would be incorrect.

ts2hx uses the same ordered request plan for every supported effective ESM
import, including bound imports that configured TypeScript emit retains. Those
generated carriers target classic Genes and genes-ts through the named
`genes.esm-runtime-requests` capability. A ts2hx run using
`standard-haxe-js` fails at the first effective request with
`TS2HX-MODULES-ESM-RUNTIME-TARGET-001`; compiling a Genes-profile tree with the
standard generator independently fails its Haxe macro guard.

Request-free ts2hx completion-aware Haxe remains ordinary input to all three
JavaScript lanes. The supported synchronous return/break/continue subset uses a
private `@:genes.compilerInternal` enum plus `genes.js.FinallyCompletion`:
standard Haxe executes it directly, while classic Genes and genes-ts keep the
enum local to implementation and share the same callback/precedence semantics.
The contract is intentionally exact: excluded function, carrier, label, and
loop forms still fail before output publication.

The fullstack example deliberately combines these rules: inline markup becomes
TSX in `ts-strict` and planned `createElement` calls in `classic-esm`; raw TS
type metadata enriches TS/declarations but disappears from executable classic
JS; authored npm/TS modules remain ordinary bundler inputs in either profile.

`Undefinable<T>` means “a `T`, or JavaScript `undefined`.” That is different from Haxe `Null<T>`/JavaScript `null`: many DOM, Node, npm, and strict TypeScript APIs use `undefined` for “not provided” and reject `null`.

For example:

```haxe
import genes.ts.Undefinable;
import genes.ts.Unknown;
import genes.ts.UnknownNarrow;

typedef Env = haxe.DynamicAccess<Undefinable<String>>;

final absent = Undefinable.absent();
final payload = Unknown.fromBoundary(haxe.Json.parse(text));

final record = UnknownNarrow.record(payload);
final name = record == null ? null : UnknownNarrow.string(record.get("name"));
```

In TypeScript source output:

- `Undefinable<T>` can emit as `T | undefined`.
- `Unknown` can emit as TypeScript `unknown`.
- `UnknownNarrow.record` can return a read-only record view for checked field decoding.
- future helpers can model import types, type queries, JSX element types, or other TS-only declaration shapes.

In classic Genes JS output:

- TypeScript-only annotations erase.
- helper runtime behavior remains plain JavaScript/ES6.
- unsupported helpers should fail with a documented target guard instead of producing misleading output.

In the currently exercised subset, that lets a project compile the same Haxe
source to rich, idiomatic TypeScript when it wants reviewable TS or deep
ecosystem interop, and to plain ES6 when it wants a simpler/faster runtime
pipeline. JSX marker intent is shared: TypeScript selects TSX or typed
createElement syntax, while classic JS selects equivalent React-compatible
runtime calls. Disabling a required runtime namespace is a source-positioned,
pre-output capability error rather than marker leakage.

This portability goal must not reduce TypeScript quality. The TypeScript emitter should still print precise, idiomatic, readable TS. Internally, the compiler should model these helpers with shared semantics and target-specific emitters/printers rather than scattering one-off string rewrites through the codebase.

## Directory conventions (recommended)

genes-ts writes output wherever you point `-js <path>`. For most projects, these naming conventions
minimize confusion:

- `src-gen/` — generated TypeScript source from genes-ts (intermediate; meant to be compiled by TS tooling).
- `dist/` — built runtime artifacts (JS, `.d.ts`, bundler output).
- `dist-ts/` — optional checked-in generated TS source tree (useful for examples and audit trails).
