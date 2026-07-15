# TypeScript typing audit (genes-ts)

This document records the current typing evidence and remaining threat model for
generated TypeScript. It distinguishes intended policy from demonstrated
coverage; a green `tsc` run is necessary but not sufficient evidence of a sound
public API.

## Scope

- **User modules:** should not export `any` or unjustified `unknown` unless the
  Haxe source deliberately declares a dynamic foreign boundary.
- **Runtime boundary (`genes/*`):** narrow, documented unsafety is acceptable
  for heterogeneous registries, prototype mutation, and raw JS interop.
- **Stdlib/extern output (`haxe/*`, `js/*`, `sys/*`):** should model the Haxe JS
  runtime and host libraries precisely. Broad directory exclusions are not a
  substitute for semantic inspection.
- **Classic declarations:** are a separate public product surface and must be
  tested as an external strict TypeScript consumer.

## Verified improvements as of 2026-07-14

### Closed interface surfaces

Ordinary generated interfaces no longer receive an unconditional
`[key: string]: any` signature. Public interface members are captured before
DCE removes implementation details, and the full fixture includes a negative
consumer that requires an unknown member access to fail.

This closes the concrete `IMap` masking defect. It does not yet replace every
dependency/reachability path with an explicit graph.

### Shared public-surface planning

`PublicSurface` now captures classes, interfaces, typedef bodies, applied parent
types, public instance/static members, method generics, overload sets, source
metadata, and compiler-generated classification before runtime DCE. Generated
TS interfaces and classic declarations consume those same facts. Focused
positive and negative consumers cover generic parent substitution, closed
interfaces, overload identity, and exclusion of private runtime helpers.

TS implementation interfaces intentionally retain classified Haxe accessor
support methods when emitted class bodies call them directly; classic consumer
declarations suppress those implementation details. Classic class declarations
currently intersect the shared surface with runtime-retained members until the
declaration-only dependency graph can retain referenced types independently.

### Precise classic nullability

Classic `.d.ts` emission again represents Haxe `Null<T>` as a nullable union
instead of `any`. A strict external consumer checks nullable `IMap.get`, closed
interfaces, `skipLibCheck: false`, exact optional properties, and unchecked
index access.

### Native map absence

`genes.util.EsMap.get` now exposes `Null<V>` and normalizes a missing native
`Map` entry to Haxe `null`, while preserving a deliberately stored JavaScript
`undefined`. Runtime and negative type tests protect both cases.

### Iterator protocol bridging

Haxe's iterator-step structure maps to TypeScript's
`IteratorResult<T, undefined>` where that is the actual runtime contract,
rather than using a broad return type.

### Shared nullish planning

`NullishContract` now classifies Haxe `Null<T>`, explicit JavaScript
`undefined`, unknown/dynamic boundaries, optional properties, optional
parameters, native-map absence, and iterator completion before target syntax is
printed. TS implementation fields, classic JS normalization decisions, TS
interfaces, and classic declarations consume those facts instead of maintaining
separate `allowsNull`/`Undefinable` classifiers.

A same-source fixture executes under TS-source and classic JS output. Strict TS
and classic declaration consumers additionally enable
`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`, with negative cases
for null-versus-undefined writes and calls. Function-valued optional fields are
explicitly grouped before adding `| undefined`, protecting TypeScript operator
precedence as well as the semantic classification.

## Remaining ingress paths

1. **Inferred or imported `any`:** a lexical scan cannot see an unsafe type
   acquired from another generated declaration or import.
2. **Unjustified structural openness:** an index signature using `unknown`
   would still mask member mistakes even though it contains no `any` token.
3. **Metadata overrides:** `@:ts.type`, `@:genes.type`, import metadata, and
   extern package shapes can bypass ordinary Haxe type mapping.
4. **Runtime/stdlib exclusions:** reflection and boot code need narrow unsafe
   operations, but those operations must not escape into user exports.
5. **Declaration-only reachability:** classic class declarations still require
   the runtime-member intersection described above; TS implementation types do
   not yet consume an explicit declaration dependency graph either.

## Evidence layers

| Layer | Current evidence | Blind spot |
| --- | --- | --- |
| Strict positive compilation | Basic, minimal, full, TSX, snapshots, and todoapp profiles | `any` is assignable in both directions and can make invalid code pass. |
| Negative consumers | Closed interfaces, classic nullable declarations, React prop snapshots | The matrix is not yet exhaustive across all exported/imported types. |
| Lexical unsafe-type scan | Selected generated user files | Inference, aliases, imports, declaration merging, and excluded directories. |
| Runtime assertions | Map absence/undefined, iterator and general compiler fixtures | Public declaration precision not observed at runtime. |
| Semantic export inspection | TypeChecker audit of generated TS and classic declarations with exact boundary provenance | Coverage is fixture-scoped and does not replace dependency planning. |

## Next tightening targets

1. `genes-09r.3`: make runtime, type-only, and declaration-only dependencies
   explicit so a type printer cannot silently change reachability.
2. `genes-09r.5`: broaden JSX negative coverage across intrinsic props,
   components, children, spread props, and imported JSX namespaces.
3. `genes-09r.4`: separate emitted-code compatibility lanes from
   TypeScript-compiler-API compatibility and centralize toolchain versions.

The desired end state is an allowlisted boundary manifest with a stable ID,
owner, reason, and source provenance for every public dynamic escape hatch.
Runtime internals may remain dynamic where JavaScript semantics require it;
normal user APIs may not become dynamic merely to make code generation easier.
