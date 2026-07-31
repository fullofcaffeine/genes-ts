# Haxe byte-buffer runtime caches

This fixture proves a small interoperability contract between three pieces of
the JavaScript ecosystem:

- Haxe 4.3.7's `haxe.io.Bytes`;
- hxnodejs 10.0.0's zero-copy `Buffer.hxToBytes()` helper; and
- the standard TypeScript declarations for `ArrayBuffer`, `Uint8Array`, and
  Node `Buffer`.

No knowledge of GameCarry or Tink is required to understand the problem.
GameCarry merely supplied the larger program that exposed it.

## Why these private properties exist

`haxe.io.Bytes` is Haxe's byte container. On JavaScript, its real storage is a
native `Uint8Array` over an `ArrayBuffer`. Haxe writes three extra properties
so repeated conversions can reuse the same wrapper and backing storage:

```haxe
// Haxe 4.3.7 JS standard library, simplified
function new(data:ArrayBuffer) {
  final byteView = new Uint8Array(data);
  untyped {
    byteView.bufferValue = data;
    data.hxBytes = this;
    data.bytes = byteView;
  }
}
```

hxnodejs follows the same convention when it creates a `Bytes` wrapper around
a Node `Buffer`. `Object.create(Bytes.prototype)` installs the correct
JavaScript prototype without copying the bytes:

```haxe
// hxnodejs 10.0.0, simplified
static function bytesOfBuffer(buffer:Buffer):Bytes untyped {
  final wrapper = Object.create(Bytes.prototype);
  wrapper.length = buffer.byteLength;
  wrapper.b = buffer;
  buffer.bufferValue = buffer;
  buffer.hxBytes = wrapper;
  buffer.bytes = buffer;
  return wrapper;
}
```

The runtime behavior is intentional, but these properties are not part of the
standard TypeScript library. An arbitrary `ArrayBuffer` or `Uint8Array` may not
have them at all, so declaring them as required would also be inaccurate.

## What failed in generated TypeScript

Genes already declared part of the host shape, but it described `hxBytes` only
as `object | undefined` and did not expose `hxBytes` or `bytes` on
`Uint8Array`. Strict TypeScript therefore rejected standard-library code such
as:

```ts
const cached: Bytes | null = data.hxBytes;
// Error: object | undefined is not assignable to Bytes | null.
```

It also rejected cache reads because the honest ambient property is optional:

```ts
return data.bytes[index];
// Error: data.bytes is possibly undefined.
```

That diagnostic must not be suppressed for an arbitrary buffer: `data.bytes`
really can be absent. Genes may strengthen it only when the typed Haxe program
still contains proof that the runtime initialized this particular property.

Finally, TypeScript could see only the fields assigned to the object created by
hxnodejs, not the `Bytes.prototype` relationship established at runtime:

```ts
const wrapper: { length: number; b: Buffer } =
  Object.create(Bytes.prototype);
return wrapper;
// Error: the structural object is missing Bytes methods.
```

In an external comparison against the package-neutral `tink_cli` pressure
fixture and GameCarry, the complete byte-cache cluster accounted for eleven of
22 remaining strict TypeScript diagnostics. This focused change safely removes
five, taking both programs from 22 to 17. The remaining six are intentionally
left visible for the reason explained below; the numbers are downstream
observations, not assertions made by this compiler-owned fixture.

## How Genes represents the contract

The generated global augmentation lists only the properties that the Haxe and
hxnodejs runtimes actually write:

```ts
declare global {
  interface Uint8Array {
    bufferValue?: ArrayBuffer | Uint8Array;
    hxBytes?: object;
    bytes?: Uint8Array;
  }

  interface ArrayBuffer {
    hxBytes?: object;
    bytes?: Uint8Array;
  }
}
```

`bufferValue` is a union because Haxe stores an `ArrayBuffer`, while hxnodejs
stores the Node `Buffer` itself; Node `Buffer` is a `Uint8Array` subclass.
Every property remains optional because a fresh native buffer has not
necessarily passed through either runtime. Genes does not add a catch-all index
signature.

The immutable TypeScript boundary plan then records stronger facts only where
the typed Haxe AST retains enough evidence to prove them.

A nullable wrapper lookup first converts JavaScript's missing-property
`undefined` to the `null` sentinel Haxe expects:

```ts
const cached: Bytes | null =
  Register.unsafeCast<Bytes | null>((data.hxBytes ?? null));
```

When Haxe's typed destination requires `ArrayBuffer`, a `bufferValue` read from
the exact private storage field of a typed `haxe.io.Bytes` instance receives a
presence assertion and an exact identity assertion:

```ts
return Register.unsafeCast<ArrayBuffer>(bytes.b.bufferValue!);
```

The hxnodejs prototype-backed object receives one assertion at its exact return
boundary inside the exact `js.node.buffer.Buffer.Helper.bytesOfBuffer` helper:

```ts
return Register.unsafeCast<Bytes>(wrapper);
```

`Register.unsafeCast<T>(value)` does not convert, clone, validate, or wrap the
value. Its JavaScript implementation returns `value` unchanged. The generic
`T` exists only while TypeScript checks the generated source.

The prototype proof fails closed. Genes records it only when:

1. the code is the exact hxnodejs helper that owns this runtime convention;
2. the local comes from the exact `js.lib.Object.create` field;
3. the argument is the `.prototype` of the typed `haxe.io.Bytes` class;
4. the same local reaches the return;
5. the local has not been reassigned; and
6. `haxe.io.Bytes` exactly matches the declared return type.

The negative fixture covers both a different prototype and a correctly created
prototype local that is later reassigned to `{}`. Neither receives an
assertion, and strict TypeScript continues to report the structural mismatch.
Other classes constructed through `Object.create(Target.prototype)` remain
outside this compatibility rule. A user class with ordinary fields named
`hxBytes`, `bytes`, or `bufferValue` is also emitted directly.

## Why `Bytes.fastGet` remains a TypeScript error

The Haxe standard library exposes a helper whose source can be simplified to:

```haxe
public static inline function fastGet(data:BytesData, index:Int):Int {
  return untyped data.bytes[index];
}
```

Calling that exact helper is meaningful: `BytesData` came from Haxe's byte
machinery, so its `bytes` cache should exist. However, `inline` tells the Haxe
compiler to replace the call with the helper body before Genes receives the
typed AST. A downstream call such as:

```haxe
final value = Bytes.fastGet(data, index);
```

therefore reaches Genes as if the downstream class had authored:

```haxe
final value = untyped data.bytes[index];
```

At that point there is no remaining `Bytes.fastGet` call identity. Adding `!`
merely because a native buffer property is spelled `bytes` would also bless
this unsafe program:

```haxe
final fresh = new ArrayBuffer(1);
return untyped fresh.bytes[0];
```

That property is absent at runtime. The generated TypeScript must keep the
warning:

```ts
return fresh.bytes[0]!;
//     ~~~~~~~~~~~
// Error: 'fresh.bytes' is possibly 'undefined'.
```

The final `!` shown here belongs to Genes's existing
`noUncheckedIndexedAccess` array-index rule; it says only that index `0`
contains a value. It does not claim that the optional `bytes` object exists.
The stdlib-overlay fixture separately proves that an *unused* `fastGet` method
is pruned under default `-dce std`, matching Haxe's official std-path behavior.
That packaging fix does not change this typed-evidence rule. The negative
fixture calls `Bytes.fastGet` explicitly and keeps the resulting inlined
TS18048 visible, alongside a directly authored unsafe cache read. A future
assertion fix would still need compiler evidence stronger than the property
name.

Classic JavaScript contains none of these TypeScript assertions:

```js
return data.bytes[index];
return bytes.b.bufferValue;
return wrapper;
```

## Evidence

Run:

```bash
yarn test:byte-buffer-cache
```

The task:

- compiles the real Haxe 4.3.7 `Bytes` implementation;
- compiles the real hxnodejs 10.0.0 buffer helper;
- checks the same generated TypeScript with pinned TS 5, TS 6, and TS 7 under
  `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and
  `skipLibCheck: false`;
- runs TypeScript-readable, classic Genes, and standard Haxe JavaScript and
  compares their exact output;
- proves same-named user fields, a fresh native buffer, a mismatched prototype,
  and an exact helper whose prototype-backed local was reassigned receive no
  bridge; and
- proves both a direct optional-cache read and an explicitly requested,
  inlined `Bytes.fastGet` read retain TS18048; and
- verifies the added syntax maps to the authored Haxe line.

Prepared by the GameCarry agent.
