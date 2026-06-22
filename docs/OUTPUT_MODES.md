# Output modes (genes-ts)

genes-ts supports **two output modes** within the same library (`-lib genes-ts`).

The mode is selected by the presence of `-D genes.ts`.

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
- `genes.react.JSX.jsx(...)` + inline markup are intended for this mode (see `docs/typescript-target/REACT_HXX.md`).

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

## Picking a mode

- If your goal is “Haxe is a better language on top of TS, and we may port to TS later” → use **TypeScript output** (`-D genes.ts`).
- If your goal is “we keep writing Haxe, but want modern ESM output + excellent `.d.ts`” → use **classic Genes JS output** (omit `-D genes.ts`, keep `-D dts`).

## TypeScript-aware helpers that still run as ES6

The two modes are not meant to force two Haxe codebases. genes-ts should let you write one Haxe source tree and choose the output profile later.

For JS/TS ecosystem projects, the recommended authoring model is **TS-minded Haxe**. Write normal Haxe, but keep the TypeScript boundary contracts in mind: use Haxe typedefs, enums, abstracts, externs, and focused `genes.ts` helpers where they make DOM, Node, npm, or generated declaration shapes more precise.

For TypeScript-specific ecosystem concepts, prefer small Haxe helper types instead of raw emitted strings.

Current examples:

| Helper | Why it exists | TS output idea | JS output idea |
| --- | --- | --- | --- |
| `genes.ts.Undefinable<T>` | Many TS APIs use `undefined` for “not provided” and reject `null`. Haxe `Null<T>` alone cannot express that contract. | `T | undefined` | Runtime value is `T` or real `undefined`. |
| `genes.ts.Unknown` | Raw JSON, plugin payloads, host APIs, and caught JS values may be untrusted. TS `unknown` is safer than `any` because users must narrow/decode before use. | `unknown` | A contained Haxe abstract over the runtime value. |
| `genes.ts.UnknownNarrow`, `UnknownRecord`, `UnknownArray` | Haxe can run JS runtime checks, but it cannot represent TypeScript's control-flow proof that an `unknown` is now a string, record, or array. | Guarded helpers over `unknown`, `Readonly<Record<string, unknown>>`, and `readonly unknown[]`. | The same `typeof`, `Array.isArray`, `Object.keys`, and own-property checks as plain ES6. |
| `genes.ts.Imports` | Existing npm/TS/TSX modules need value, type, default, named, namespace, and attributed imports. Import syntax should be generated consistently instead of scattered as strings. | Idiomatic ESM imports and type imports. | Equivalent ESM imports in classic JS output where applicable. |

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

In practice, that lets a project compile the same Haxe source to rich, idiomatic TypeScript when it wants reviewable TS or deep ecosystem interop, and to plain ES6 when it wants a simpler/faster runtime pipeline.

This portability goal must not reduce TypeScript quality. The TypeScript emitter should still print precise, idiomatic, readable TS. Internally, the compiler should model these helpers with shared semantics and target-specific emitters/printers rather than scattering one-off string rewrites through the codebase.

## Directory conventions (recommended)

genes-ts writes output wherever you point `-js <path>`. For most projects, these naming conventions
minimize confusion:

- `src-gen/` — generated TypeScript source from genes-ts (intermediate; meant to be compiled by TS tooling).
- `dist/` — built runtime artifacts (JS, `.d.ts`, bundler output).
- `dist-ts/` — optional checked-in generated TS source tree (useful for examples and audit trails).
