# JavaScript standard-library overlays

Genes normally compiles the standard library shipped with the selected Haxe
version. A small number of JavaScript-specific standard-library
implementations can, however, erase type evidence that Genes needs to produce
honest strict TypeScript. In that case the Genes distribution may carry a
narrow, reviewed source overlay.

An overlay is not a general way to patch Haxe. It is a complete
platform-specific Haxe module whose provenance and exact edits are recorded in
[`config/stdlib-overrides.json`](../config/stdlib-overrides.json).

## Why Genes owns this kind of correction

Haxe is the language frontend and standard-library foundation under Genes.
Genes is the compiler distribution that an application installs with Lix:

```hxml
-lib genes-ts
```

Forking and redistributing the complete Haxe compiler to change one
JavaScript-only standard-library implementation would make users consume a
custom parser, typer, macro runtime, optimizer, every target library, and every
future Haxe maintenance change. That ownership is much larger than the actual
problem.

Genes instead owns a target-specific module when all of these are true:

- the issue is in a Haxe JavaScript standard-library implementation;
- the correction is needed for Genes' honest TypeScript or JavaScript surface;
- the behavior can be expressed as ordinary Haxe source;
- classic JavaScript behavior remains compatible; and
- the exact upstream file and local edits can be pinned and tested.

A Haxe change is still the right owner for parser, typer, inlining, DCE, macro
API, or shared cross-target behavior that a Genes source overlay cannot
represent.

## Why the filename ends in `.js.hx`

Genes can emit TypeScript-readable source, but Haxe still runs its JavaScript
target in both Genes output profiles:

```text
Haxe JavaScript target
        |
        +-- Genes TypeScript-readable profile  -> .ts
        |
        `-- Genes classic JavaScript profile   -> .js
```

Haxe's platform-specific module convention therefore uses `js`:

```text
src/haxe/io/Bytes.js.hx
```

It is not `Bytes.ts.hx`. `ts` is not the active Haxe platform, so Haxe would
not select that file.

`haxelib.json` exposes Genes' `src/` directory. When `-lib genes-ts` is
resolved, that classpath precedes Haxe's own standard library. On the
JavaScript target, Haxe resolves `haxe.io.Bytes` to the earlier
`haxe/io/Bytes.js.hx`. Both Genes profiles therefore consume the same typed
source and may choose different output syntax without changing its meaning.

## Relationship to Reflaxe compilers

The ownership idea follows the established Reflaxe family pattern: a compiler
distribution may ship a small target standard library instead of requiring a
fork of all Haxe. Reflaxe.Ruby and Reflaxe.Elixir author replacements under
target `_std` directories. Reflaxe's package builder then flattens colliding
modules to `.cross.hx`, because those compilers run through Haxe's custom
`cross` target and must bootstrap their own target classpaths.

Genes does not copy that machinery because Genes remains a Haxe JavaScript
target. Haxe already provides the exact selection mechanism Genes needs:
`.js.hx` plus the normal `-lib genes-ts` classpath. Using the native mechanism
is smaller, easier to inspect, and works the same from a source checkout and a
packaged Haxelib/Lix dependency.

The borrowed principle is:

> Keep a target-library correction inside the compiler distribution that owns
> that target.

The implementation differs because Reflaxe's targets are `cross`, while
Genes' target is `js`.

## Preserve the standard library's DCE behavior

Classpath selection changes more than the source location shown in a stack
trace. Haxe's default `-dce std` mode uses that location as compiler evidence:
classes loaded from Haxe's own standard-library directories are eligible for
field-level dead-code elimination.

A Genes overlay is loaded from the installed `genes-ts/src/` classpath instead.
Without an explicit marker, Haxe treats the copied class like an ordinary
library class and keeps all of its fields. That can expose helpers which the
official stdlib build would have removed:

```haxe
// Complete copied module, now outside Haxe's std/ directory.
@:coreApi
class Bytes {
  public inline static function fastGet(
      b:BytesData, pos:Int):Int {
    return untyped b.bytes[pos];
  }
}
```

With `-dce std`, the unmarked overlay can emit an unused `fastGet` method:

```ts
static fastGet(b: ArrayBuffer, pos: number): number {
  return b.bytes[pos]!;
  //     ~~~~~~~ TS18048: b.bytes may be undefined
}
```

The problem is not that this read needs a new assertion. The method was absent
from the equivalent official-stdlib output because no application code used
it. Genes restores that packaging behavior with Haxe's own DCE metadata:

```haxe
@:dce
@:coreApi
class Bytes {
  // Complete upstream implementation.
}
```

Haxe's DCE implementation treats a class carrying `@:dce` the same way, for
eligibility purposes, as a class loaded from its stdlib directories. Used
fields remain available; unused fields are pruned. The corrected TypeScript
therefore contains the used `toHex` implementation and no `fastGet`
declaration.

This is part of the generic overlay contract, not a `Bytes`-specific compiler
rule. When a future complete module contains classes that relied on std-path
DCE, the overlay must add `@:dce` to those classes as a separately declared
manifest edit and prove the expected used/unused field shape under
`-dce std`.

An explicit downstream call to `Bytes.fastGet` remains deliberately
fail-closed. Inlining erases the helper identity before Genes sees the typed
tree, so the generated optional-cache read still receives TS18048. DCE removes
only genuinely unused code; it must not hide an unsafe operation that the
program actually requests.

## The `haxe.io.Bytes` case

Haxe's JavaScript `String.charCodeAt` returns `Null<Int>`. That is correct for
an arbitrary index because an out-of-range read can have no character.

`Bytes.toHex` has a stronger local invariant. It walks every valid index of the
fixed string `"0123456789abcdef"`:

```haxe
var chars = [];
var str = "0123456789abcdef";

for (i in 0...str.length)
  chars.push(str.charCodeAt(i));
```

Without an annotation, Haxe 4.3.7 infers `chars` as `Array<Null<Int>>`. Later,
`StringBuf.addChar(c:Int)` and `String.fromCharCode(code:Int)` are inlined.
The final typed tree contains nullable array reads inside raw JavaScript
syntax, but no longer contains the original `Int` parameter. Genes must not
reconstruct a type from the strings `"String.fromCharCode"` or
`"String.fromCodePoint({0})"` because user code can reproduce those strings
without the missing typed contract.

The unannotated generated TypeScript is therefore honestly rejected:

```ts
const chars: (number | null)[] = [];
chars.push(HxOverrides.cca(str, i));

s_b += String.fromCodePoint((chars[c >> 4] ?? null));
s_b += String.fromCodePoint((chars[c & 15] ?? null));
//                         ^ number | null is not assignable to number
```

The overlay records the invariant where the lookup table is constructed:

```diff
-var chars = [];
+var chars:Array<Int> = [];
```

Now an ordinary typed Haxe boundary survives:

```text
source argument                         destination parameter
str.charCodeAt(i): Null<Int>  ------->  Array<Int>.push(value:Int)
```

Genes' existing boundary plan can represent that exact Haxe-accepted
conversion:

```ts
const chars: number[] = [];
chars.push(
  Register.unsafeCast<number>(HxOverrides.cca(str, i))
);

s_b += String.fromCodePoint(chars[c >> 4]!);
s_b += String.fromCodePoint(chars[c & 15]!);
```

`Register.unsafeCast<number>` does not convert, validate, or clone the value.
It is a runtime identity function: it evaluates its input once and returns the
same JavaScript value. The generic argument documents for TypeScript that Haxe
accepted this exact `Null<Int>` expression at this exact `Int` parameter.

The later `!` operators express a different fact. The array's declared element
type is already `number`; `noUncheckedIndexedAccess` adds `undefined` because
TypeScript cannot prove that the two calculated indexes exist. Haxe's fixed
lookup-table construction establishes that presence for this code.

Classic JavaScript erases both Haxe types and TypeScript-only assertions. It is
unchanged:

```js
const chars = [];
chars.push(HxOverrides.cca(str, i));

s_b += String.fromCodePoint(chars[c >> 4]);
s_b += String.fromCodePoint(chars[c & 15]);
```

## Provenance and drift protection

Haxe classpath replacement works at module granularity, so Genes must carry the
complete `Bytes` implementation even though its data-typing correction is one
line. The local module also has a class-level `@:dce` packaging marker because
moving the source outside Haxe's `std/` directory otherwise changes default
dead-code elimination.
The manifest prevents that copy from becoming a silent standard-library fork.
Each entry records:

- canonical Haxe source repository;
- Haxe version and source revision;
- original source path and SHA-256;
- pinned formatter version and formatter-canonical SHA-256;
- local overlay SHA-256; and
- every allowed exact replacement, count, and semantic reason.

The generic gate materializes the exact declared Haxe Git revision, reads the
upstream module from that authenticated tree, and also requires the active Haxe
distribution to contain those exact bytes. It verifies the selected formatter
version, formats a temporary copy, applies only the declared replacements, and
requires byte-for-byte equality with the checked-in overlay. It also requires
set equality between the manifest and every `src/**/*.js.hx` file, including
top-level modules such as `src/String.js.hx`, so an unregistered copied module
cannot bypass provenance review.

Today every `.js.hx` file under `src/` is a reviewed standard-library overlay.
If Genes later needs a platform-specific project module that does not replace
Haxe standard-library source, its path must be given an explicit, separately
reviewed exclusion rather than becoming an invisible exception to this
inventory.

If the selected Haxe version changes, the gate fails before compilation. A
contributor must review the new upstream module and update the provenance;
blindly refreshing hashes is not an acceptable upgrade.

## Adding another overlay

Use this sequence:

1. Prove that the issue belongs to a JavaScript stdlib module and cannot be
   solved from typed evidence already available to Genes.
2. Create a focused Genes Bead and isolated worktree.
3. Copy the exact module from the pinned Haxe JavaScript `_std` directory.
4. Format it with Genes' pinned Haxe formatter.
5. Save it as `src/<module path>.js.hx`.
6. Restore std-path DCE semantics for every copied class that needs them,
   normally with Haxe's compiler-authored class-level `@:dce` metadata. Record
   this as an exact manifest edit; do not compensate with `-dce full`.
7. Make the smallest semantic edit.
8. Add one manifest entry with the exact provenance and replacements.
9. Add a task-specific fixture. The manifest proves source provenance; the
   fixture must prove why the edit is correct.
10. Include a fail-closed control showing that Genes did not gain a broad
   string-, name-, position-, or generated-text rule.
11. Verify TypeScript 5/6/7, classic JavaScript parity, standard-Haxe runtime
    behavior, source maps, compiler-server cold/warm behavior, and packaged
    Haxelib/Lix selection. The package check must install the exact generated
    ZIP into an isolated local Haxelib repository and compile through
    `-lib genes-ts` using Lix's selected Haxe toolchain and default
    `-dce std`; a manually supplied package classpath or `-dce full` is not
    equivalent evidence. GameCarry pins the reviewed merge commit through its
    ordinary Lix descriptor after the PR merges.
12. Run the focused neighboring tests and the full repository gate.

Run the current generic and `Bytes` contract with:

```sh
yarn test:stdlib-overrides
```

The fixture and its expected evidence are described in
[`tests/stdlib-overrides/README.md`](../tests/stdlib-overrides/README.md).

Prepared by the GameCarry agent.
