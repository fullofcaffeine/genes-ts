# TypeScript Typing Audit (genes-ts)

This document tracks where `any` / `unknown` / “stringly” typing appears in **generated**
TypeScript output and why, with the goal of producing **idiomatic, strongly typed TS**
that is still faithful to Haxe semantics.

## Scope

- **User modules** (your app code): should not emit `any` / `unknown` unless the Haxe
  types were inherently dynamic and there is no practical alternative.
- **Runtime boundary** (`genes/*`): limited, justified `any` / `unknown` is acceptable
  for reflection/interop registry plumbing.
- **Stdlib / externs** (`haxe/*`, `js/*`, `sys/*`): prefer specific TS types, but some
  `any` may be unavoidable due to Haxe/JS semantics (we aim to minimize it).

## Current categories (as of 2026-01-25)

### 1) Runtime boundary (expected)

Examples:

- `src-gen/genes/Register.ts*`: uses `unknown` for global registry storage and exposes
  narrow helper APIs (`unsafeCast<T>`, etc) to avoid leaking `any` into user modules.

This is intentionally the *only* place where “unsafe casts” should concentrate.

### 2) Iterator protocol bridging (improved)

Haxe std defines `js.lib.IteratorStep<T>` as a structural record, but TypeScript has an
idiomatic builtin type: `IteratorResult<T, TReturn>`.

- Change: map `IteratorStep<T>` to `IteratorResult<T, undefined>` (instead of `any`)
  to keep generated output strongly typed while still matching common JS iterator
  behavior (iterator “return” value is usually unused / `undefined`).

### 3) Stdlib reflection / stringification (remaining)

Some Haxe std runtime helpers (e.g. `js.Boot` stringification / exception formatting)
are inherently dynamic. These may still require `any` in the stdlib portion of the
generated output.

The policy is:

- keep these `any`s confined to stdlib/runtime,
- avoid them in user modules, and
- tighten them when we can prove a better type without breaking semantics.

## Next tightening targets

In priority order:

1. **Iterator-related helpers** (verify all `IteratorResult<*, any>` became `undefined`).
2. **Exceptions** (`haxe.Exception`, `haxe.ValueException`): reduce `any` where possible
   by modeling payloads as `unknown` only in runtime boundary helpers (or as generics
   where Haxe exposes types).
3. **Extern-heavy DOM types**: prefer literal unions / specific DOM interfaces when Haxe
   type info is available (already partially supported via `@:enum abstract` literal unions).

