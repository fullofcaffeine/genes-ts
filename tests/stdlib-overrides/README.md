# JavaScript stdlib-overlay fixture

This fixture proves both the reusable Genes overlay mechanism and the first
reviewed module, `haxe.io.Bytes`.

## Why it exists

Haxe 4.3.7 correctly types JavaScript `String.charCodeAt` as `Null<Int>` because
an arbitrary index can be out of range. `Bytes.toHex` reads only valid indexes
from the fixed hexadecimal alphabet, but its unannotated lookup table is
inferred as `Array<Null<Int>>`.

The later `Int` parameters are inlined into raw JavaScript syntax, so the final
typed tree no longer contains a destination that would let Genes insert a
sound boundary. The old generated TypeScript remains nullable:

```ts
const chars: (number | null)[] = [];
chars.push(HxOverrides.cca(str, i));
s_b += String.fromCodePoint((chars[c >> 4] ?? null));
```

Strict TypeScript correctly rejects the call because `number | null` is not a
`number`.

The Genes-owned `Bytes.js.hx` overlay declares the table's real invariant:

```haxe
var chars:Array<Int> = [];
```

This keeps an ordinary typed `Null<Int>` to `Int` boundary at
`Array<Int>.push`, before inlining erases later API parameters. Genes emits:

```ts
const chars: number[] = [];
chars.push(Register.unsafeCast<number>(HxOverrides.cca(str, i)));
s_b += String.fromCodePoint(chars[c >> 4]!);
```

Classic JavaScript is byte-for-byte unchanged for the emitted `Bytes` module.

## Why the overlay also has `@:dce`

Haxe's default `-dce std` mode recognizes classes by their source location.
The official `Bytes` class lives under Haxe's own `std/` tree, so Haxe prunes
unused fields. The copy shipped by Genes lives on the `genes-ts/src/`
classpath. Without an explicit marker, Haxe keeps the complete class and emits
the otherwise-unused raw helper:

```ts
static fastGet(b: ArrayBuffer, pos: number): number {
  return b.bytes[pos]!;
}
// TS18048: b.bytes may be undefined
```

The overlay uses Haxe's compiler-authored metadata:

```haxe
@:dce
@:coreApi
class Bytes {
  // The complete Haxe 4.3.7 implementation.
}
```

This restores the official field-pruning behavior. The generated TypeScript
keeps the used `toHex` code shown above but has no `fastGet` declaration.

This does not authorize an assertion for `fastGet`. The byte-cache negative
fixture calls that inline helper explicitly and still expects TS18048 after
inlining. In other words, DCE removes unused code; used unsafe code remains
visible.

## Why the file is `Bytes.js.hx`

Both Genes output profiles run through Haxe's JavaScript target. TypeScript is
a Genes source-emission profile, not a Haxe target named `ts`. Haxe therefore
selects `src/haxe/io/Bytes.js.hx`; it would not select `Bytes.ts.hx`.

The design borrows Reflaxe's ownership principle—ship narrow target-library
corrections with the compiler distribution—but not its `_std`/`.cross.hx`
packaging. Reflaxe compilers use Haxe's `cross` target. Genes remains on `js`,
where Haxe's built-in `.js.hx` lookup and the normal `-lib genes-ts` classpath
already provide the required behavior.

## What the test proves

```sh
yarn test:stdlib-overrides
```

The command verifies:

- manifest schema, unique module identities, Haxe version, upstream and local
  hashes, exact Git-revision source, formatter identity, formatter-canonical
  source, exact declared replacements, and manifest/filesystem set equality;
- automatic `Bytes.js.hx` selection from a Genes source checkout;
- default `-dce std` pruning of the unused `Bytes.fastGet` field, matching the
  official stdlib path behavior;
- idiomatic generated TypeScript checked by pinned TypeScript 5, 6, and 7;
- one exact identity bridge at the surviving Haxe `Array<Int>.push` boundary;
- native `!` syntax for the two known-present array reads;
- source-map ownership at the overlay's Haxe expression;
- runtime parity for TypeScript, classic Genes, the unannotated classic
  control, and official Haxe JavaScript;
- byte-identical classic `Bytes.js` with and without the type annotation;
- cold/warm compiler-server equality across TypeScript → classic → TypeScript;
  and
- a fail-closed unannotated control that still reports exactly two TS2345
  errors and receives no assertion based on raw template strings.

The release-artifact suite separately installs the generated ZIP into an
isolated local Haxelib repository and compiles a clean consumer using only
`-lib genes-ts`, default `-dce std`, and Lix's selected Haxe toolchain. That
proves packaged resolver selection and DCE parity rather than manually
recreating the package's classpath.

The expected runtime transcript is:

```text
000f107f80ff
```

The complete ownership model and future-overlay workflow are in
[`docs/STDLIB_OVERRIDES.md`](../../docs/STDLIB_OVERRIDES.md).

Prepared by the GameCarry agent.
