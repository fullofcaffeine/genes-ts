# ts2hx portability guide

ts2hx currently targets **Haxe-for-JavaScript**. Generated Haxe is not
automatically portable merely because another Haxe backend can parse it. This
guide describes how portability may be assessed later and what a project must
refactor before claiming another target.

## Current contract

- `strict-js` may rely on `js.*` externs, JavaScript truthiness, native module
  behavior, promises, prototypes, and named runtime helpers.
- `assisted` output is incomplete by definition and has no portability claim.
- A future `strict-portable` mode may accept a smaller subset, but only
  cross-target compile/runtime tests can promote that subset.

The implementation work for strict portability and semantic grading is tracked
by `genes-09r.7`.

## Proposed module grades

| Grade | Meaning | Required evidence |
| --- | --- | --- |
| P0 portable | No JS-only imports, raw syntax, dynamic boundary, or target-specific semantic helper was emitted. | Compile and semantic traces on every claimed Haxe target. |
| P1 portable-with-review | The Haxe is target-neutral in shape but contains recorded broad types or runtime assumptions. | Manual boundary review plus target tests. |
| J1 JS-semantic | Behavior is preserved only through named JS helpers/externs. | Original-TS versus Haxe-JS differential evidence. |
| A assisted | Incomplete or lossy scaffold. | No executable or portability claim. |
| U unsupported | Strict mode emitted no module. | Source-positioned diagnostic and manifest record. |

These are evidence labels, not promises. P0 does not mean "works everywhere"
until the intended targets have run the same semantic fixture.

## Adapter layers

A portable application should isolate translated code behind explicit layers:

1. **Domain layer:** normal typed Haxe records, enums, abstracts, collections,
   pure functions, and errors. It must not import `js.*` or host globals.
2. **Capability interfaces:** typed application contracts for filesystem,
   process, clock, randomness, networking, storage, UI, and scheduling.
3. **Target adapters:** small implementations for Node/browser, JVM, .NET,
   native, or another chosen backend. Host-specific externs live here.
4. **Boundary decoders/encoders:** translate untrusted JSON/host data into the
   domain model immediately and serialize typed domain values on exit.
5. **Bootstrap/composition root:** chooses adapters and wires the application;
   no product logic belongs here.

This separation is a downstream architecture. ts2hx should record which layer
an emitted JS-specific helper forces a module into; it must not guess product
abstractions or generate compiler special cases for a specific application.

## Refactoring checklist before another Haxe target

### JavaScript language/runtime assumptions

- Replace `js.Syntax.code`, `untyped`, `Dynamic`, and raw prototype operations
  with typed Haxe behavior or a target adapter.
- Make `undefined`, missing properties, explicit `null`, and omitted arguments
  into explicit domain states; other targets do not share JavaScript's exact
  absence model.
- Replace JavaScript truthiness/coercion with typed Boolean/numeric/string
  operations.
- Audit object key ordering, array holes, `NaN`, signed zero, integer overflow,
  and exception values where behavior is observable.

### Host and module APIs

- Remove direct `node:*`, browser DOM, npm, CommonJS, and ESM runtime imports
  from the domain layer.
- Wrap filesystem, environment, process, timers, networking, console, and
  cryptography behind capability interfaces.
- Replace package-global singleton assumptions with explicit dependencies.

### Async and concurrency

- Do not assume JavaScript Promise/microtask scheduling on another target.
- Express async work through a documented abstraction whose ordering,
  cancellation, error, and resource-cleanup behavior each adapter implements.
- Differentially test resolution/rejection/finally order before and after the
  refactor.

### Types and data

- Replace generated externs and structural host objects with typed domain
  models.
- Decode untrusted payloads instead of moving `Unknown`/`Dynamic` throughout
  the application.
- Review integer widths, binary buffers, dates/time zones, regex behavior, and
  Unicode normalization for the destination target.

### Reflection and identity

- Audit runtime class names, `instanceof`, enum metadata, reflection registries,
  and serialized constructor names.
- Prefer explicit tags/registries owned by the domain when identity crosses a
  process or persistence boundary.

## Verification checklist

1. Run ts2hx with a manifest and require no `A` or `U` module in code claimed
   executable.
2. Require all domain modules to be P0/P1 and inspect every P1 reason.
3. Compile the same source with the JS reference target and each proposed Haxe
   target.
4. Run stable semantic traces for domain behavior, boundary encoding, errors,
   ordering, and async/resource cleanup.
5. Record target/toolchain pins and known divergences in a deterministic
   compatibility manifest.
6. Promote a feature from JS-only to portable only after a focused generic
   fixture demonstrates it; never infer portability from a downstream smoke
   build alone.

PiMonoHX and OpenCodeHX may reveal useful host seams later, but every reusable
finding must first be reduced to a generic language/runtime fixture. Full WIP
applications are evidence sources, not portable-subset definitions.
