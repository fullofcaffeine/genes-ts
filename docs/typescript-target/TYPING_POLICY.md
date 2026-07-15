# Typing policy (genes-ts): idiomatic, strict TypeScript output

genes-ts aims to generate **idiomatic, strongly typed TypeScript** as the
*primary* output artifact.

This document defines the typing goals, the supported profiles, and the rules
for when we permit escape hatches like `any`.

It is a normative policy, not a claim that a green `tsc` build proves every
generated public surface sound. Current evidence includes closed-interface
negative consumers and a strict classic declaration consumer. The semantic
export audit tracked by `genes-09r.1` will additionally detect inferred and
imported unsafe types that a source-text scan cannot see.

## Goals

1) **Generated TS should look like real TS**
- Prefer `export class`, `export interface`, `export type`.
- Prefer TS builtin types (e.g. `PromiseSettledResult<T>`) over hand-rolled
  “stringly” shapes when they match semantics.

2) **Avoid `any` / `unknown` in generated code**
- For normal user code, we target **zero** `any`/`unknown`.
- `Dynamic` is the primary exception (see below).

3) **Be honest about nullability**
- genes-ts supports two nullability profiles:
  - **TS-strict (default):** `strictNullChecks: true`
  - **Haxe-null-tolerant:** `strictNullChecks: false`

## Nullability profiles

### Default: TS-strict (`strictNullChecks: true`)

- `Null<T>` is emitted as `T | null`.
- Everything else is emitted as non-null unless it is explicitly modeled as
  nullable in the Haxe type.

This profile produces TS that is easiest to migrate to hand-written TypeScript.

Recommended `tsconfig.json` template:

```json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true
  }
}
```

### Optional: Haxe-null-tolerant (`strictNullChecks: false`)

- Intended for projects that want a smoother “Haxe semantics on JS” experience.
- TS allows `null` in most places, so the output stays cleaner without forcing
  pervasive unions.

Recommended: keep `strict: true` but set `strictNullChecks: false` in your
`tsconfig.json`.

Recommended `tsconfig.json` template:

```json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": false
  }
}
```

Optional (recommended for this profile): compile with `-D genes.ts.no_null_union`
to erase `Null<T>` unions in the emitted TS.

## Mapping rules (high-level)

### Core primitives

- `String` → `string`
- `Int`/`Float` → `number`
- `Bool` → `boolean`
- `Void` → `void`

### Standard library / JS externs (prefer TS builtins)

Where TypeScript already has a well-known type with correct semantics, prefer it:

- `js.lib.Promise<T>` → `globalThis.Promise<T>`
- `js.lib.Promise.PromiseSettleOutcome<T>` → `PromiseSettledResult<T>`
- `js.lib.Object.ObjectPropertyDescriptor` → `PropertyDescriptor`
- Etc.

This reduces “stringly” outputs (like `status: string`) and avoids `any` where
TypeScript already provides a better model.

### Enum abstracts (prefer literal unions)

Haxe `enum abstract` types (especially JS/DOM enums like `js.html.RequestCache`)
should not degrade to plain `string`/`number` when the valid values are known.

In genes-ts mode, when values are known, we emit **TypeScript literal unions**:

- `enum abstract RequestCache(String)` → `"default" | "no-store" | ..."`

If values cannot be determined (e.g. unusual extern patterns), we fall back to
the underlying type.

### `Dynamic`

- Legacy default: `Dynamic` → `any`, matching the explicitly dynamic Haxe
  source contract.
- Optional: `Dynamic` → `unknown` via `-D genes.ts.dynamic_unknown`.
- New framework, fixture, and public API code should prefer typed externs,
  abstracts, JSON algebras, or decoders. `Dynamic` is a boundary escape hatch,
  not the normal way to make generated TypeScript compile.

## Escape hatches (`any` / `unknown`)

### Rule: only inside the runtime boundary

`any`/`unknown` is acceptable in a **small, clearly-defined runtime boundary**
(e.g. `genes/Register.ts`) when:

1) the behavior is inherently dynamic (reflection registry, prototype mutation,
   raw JS interop), and
2) there is no practical TS type that preserves both correctness and developer
   ergonomics.

### Mandatory justification comments

Whenever `any`/`unknown` is used in runtime code, the generated TS should include
a short comment explaining why it is required.

Example:

```ts
// genes-ts: any is required here because $hxClasses is a dynamic registry
// populated at runtime with heterogeneous values (constructors, enums, etc).
```

## How the policy is enforced

No single gate is treated as proof of type soundness:

1. **Strict `tsc` builds** validate generated syntax, module resolution, and the
   assignments exercised by positive fixtures.
2. **Negative consumers** use `@ts-expect-error`; if an interface opens or a
   result becomes `any`, the now-unused directive fails the build.
3. **The lexical typing scan** cheaply rejects selected literal `any`/`unknown`
   forms outside its documented runtime/stdlib exclusions.
4. **The classic declaration consumer** installs the generated declarations as
   an external package and compiles with `skipLibCheck: false` and strict
   nullability/indexing options.
5. **The semantic exported-surface audit** (`genes-09r.1`, open) will walk
   exported symbols through the TypeScript Compiler API and report inferred or
   imported `any`, unjustified `unknown`, and unapproved index signatures.

Passing only the first or third layer must not be described as proof that the
public API is strongly typed. Any approved dynamic boundary should eventually
carry a stable ID, owner, reason, and provenance rather than relying on a broad
directory exclusion.

## Non-goals

- Perfectly modeling all of non-null-safe Haxe’s “implicit nullability” under TS
  strict null checks. For projects that need this, use the null-tolerant profile.
