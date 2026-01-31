# Minimal runtime profile (`-D genes.ts.minimal_runtime`)

`-D genes.ts.minimal_runtime` opts into a **TS-first** runtime profile that aims
to reduce Haxe/Genes reflection surface and “registry” behavior in the emitted
output.

This profile is intended for projects that:

- don’t need Haxe-style string-based reflection, and/or
- want output closer to “handwritten TS” while still compiling from Haxe.

---

## What changes (guaranteed in v1)

### 1) No *automatic* `$hxClasses` / `$hxEnums` registration for generated types

In the default runtime profile, genes-ts emits registrations like:

- `Register.setHxClass("my.app.MyClass", MyClass)`
- `Register.setHxEnum("my.app.MyEnum", MyEnum)`

When `-D genes.ts.minimal_runtime` is enabled, genes-ts **does not emit those
registrations**.

Practical consequence:

- `Type.resolveClass("my.app.MyClass")` / `Type.resolveEnum("my.app.MyEnum")`
  behave as “not found” (they resolve through these registries on JS/Genes).

Important nuance:

- The registries may still exist and may still contain **stdlib/builtin** entries
  (e.g. `Array`) because the Haxe stdlib itself may touch them.
- The contract is specifically about *generated user-defined types* not being
  registered by the emitter.

This is the main behavioral change in v1.

---

## What does not change (still emitted in v1)

Minimal runtime is **not** “zero runtime”.

The profile currently still emits:

- the Genes runtime helpers (`genes.Register`) used for:
  - cycle handling (`Register.inherits`, `Register.extend`)
  - safe typing boundaries (`Register.unsafeCast`)
- class / enum identity helpers used by the stdlib in common cases, such as:
  - `__name__` / `__class__` accessors on classes
  - enum constructor metadata (`__constructs__`, `_hx_index`, `__enum__`, etc.)

This means many “direct reference” reflection-ish operations still work, e.g.
getting a class name from a `Class<T>` value.

---

## How we test it

We keep two kinds of coverage green:

1) **Snapshot + runtime fixture** under `tests/genes-ts/snapshot/minimal/`
   - asserts registries are not populated
   - asserts at least one “direct reference” reflection helper still works

2) **Todoapp variants** (acceptance harness)
   - `examples/todoapp/web/build.minimal.hxml`
   - `examples/todoapp/server/build.minimal.hxml`
   - snapshots are committed under:
     - `examples/todoapp/web/dist-ts-minimal/src-gen/**`
     - `examples/todoapp/server/dist-ts-minimal/src-gen/**`

Run locally:

```bash
yarn test:genes-ts:minimal
yarn test:acceptance
```

---

## If you need string-based reflection

Do not enable minimal runtime if you depend on:

- `Type.resolveClass(...)` / `Type.resolveEnum(...)` (by string name), or
- libraries/frameworks that rely on `$hxClasses` / `$hxEnums`.

Use the default runtime profile instead.
