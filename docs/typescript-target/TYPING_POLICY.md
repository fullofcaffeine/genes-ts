# Typing policy (genes-ts): idiomatic, strict TypeScript output

genes-ts aims to generate **idiomatic, strongly typed TypeScript** as the
*primary* output artifact.

This document defines the typing goals, the supported profiles, and the rules
for when we permit escape hatches like `any`.

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

### Optional: Haxe-null-tolerant (`strictNullChecks: false`)

- Intended for projects that want a smoother “Haxe semantics on JS” experience.
- TS allows `null` in most places, so the output stays cleaner without forcing
  pervasive unions.

Recommended: keep `strict: true` but set `strictNullChecks: false` in your
`tsconfig.json`.

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

### `Dynamic`

- Default: `Dynamic` → `any` (because it is literally “dynamic” in Haxe).
- Optional future mode: `Dynamic` → `unknown`.

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

## Non-goals

- Perfectly modeling all of non-null-safe Haxe’s “implicit nullability” under TS
  strict null checks. For projects that need this, use the null-tolerant profile.

