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

It also rejected initialized cache reads because the honest ambient property is
optional:

```ts
return data.bytes[index];
// Error: data.bytes is possibly undefined.
```

Finally, TypeScript could see only the fields assigned to the object created by
hxnodejs, not the `Bytes.prototype` relationship established at runtime:

```ts
const wrapper: { length: number; b: Buffer } =
  Object.create(Bytes.prototype);
return wrapper;
// Error: the structural object is missing Bytes methods.
```

Against the package-neutral `tink_cli` pressure fixture and GameCarry, this
single runtime-cache mismatch accounted for eleven of the 22 remaining strict
TypeScript diagnostics.

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

The immutable TypeScript boundary plan then records stronger facts only at the
exact Haxe reads that need them.

A nullable wrapper lookup first converts JavaScript's missing-property
`undefined` to the `null` sentinel Haxe expects:

```ts
const cached: Bytes | null =
  Register.unsafeCast<Bytes | null>((data.hxBytes ?? null));
```

A read whose source contract says the byte view was initialized uses one
TypeScript presence assertion:

```ts
return data.bytes![index]!;
```

The first `!` is for the optional `bytes` cache. The second is the existing
array-index contract under TypeScript's `noUncheckedIndexedAccess`; neither
operator emits JavaScript or performs a runtime check.

When Haxe's typed destination requires `ArrayBuffer`, the union-valued
`bufferValue` cache receives both a presence assertion and an exact identity
assertion:

```ts
return Register.unsafeCast<ArrayBuffer>(bytes.b.bufferValue!);
```

The hxnodejs prototype-backed object receives one assertion at its exact return
boundary:

```ts
return Register.unsafeCast<Bytes>(wrapper);
```

`Register.unsafeCast<T>(value)` does not convert, clone, validate, or wrap the
value. Its JavaScript implementation returns `value` unchanged. The generic
`T` exists only while TypeScript checks the generated source.

The prototype proof fails closed. Genes records it only when:

1. the local comes from the exact `js.lib.Object.create` field;
2. the argument is the `.prototype` of a typed Haxe class;
3. the same local reaches the return; and
4. that class exactly matches the declared return type; and
5. that exact class is `haxe.io.Bytes`.

The negative fixture creates an object from `Array.prototype` and returns it as
`Bytes`. It receives no assertion, and strict TypeScript continues to report
the structural mismatch. Other classes constructed through
`Object.create(Target.prototype)` remain outside this compatibility rule. A
user class with ordinary fields named `hxBytes`, `bytes`, or `bufferValue` is
also emitted directly.

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
- proves same-named user fields and a mismatched prototype receive no bridge;
  and
- verifies the added syntax maps to the authored Haxe line.

Prepared by the GameCarry agent.
