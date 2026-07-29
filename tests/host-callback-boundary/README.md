# Native host callback boundary

This dependency-free fixture explains a narrow difference between Haxe's
generated browser externs and TypeScript's DOM declarations.

## Why a valid Haxe assignment can fail in TypeScript

Haxe 4.3.7 declares several WebIDL event properties with the deliberately
opaque type `haxe.Constraints.Function`. For example, Haxe accepts:

```haxe
function install(reader:js.html.FileReader):Void {
  reader.onerror = function(error:js.lib.Error):Void {
    trace(error.message);
  };
}
```

That Haxe type says only “this property is callable.” TypeScript's DOM library
contains more detail: `FileReader.onerror` receives a
`ProgressEvent<FileReader>`. A direct translation therefore fails strict
TypeScript:

```ts
reader.onerror = function (error: globalThis.Error) {
  console.log(error.message);
};
```

The browser still stores and invokes exactly the callback Haxe supplied. The
problem is that the two compilers describe the property differently.

## What Genes emits

Genes asks TypeScript to use the destination property's own declaration:

```ts
reader.onerror = Register.unsafeCast<typeof reader.onerror>(
  function (error: globalThis.Error) {
    console.log(error.message);
  }
);
```

`Register.unsafeCast` is a runtime identity function. It returns the same
callback reference and does not wrap, bind, validate, or convert it. The
`typeof reader.onerror` portion is a TypeScript type query; it does not read the
property or evaluate `reader` at runtime.

## Why nullable inlined receivers fail closed

Haxe can inline a method and introduce a temporary whose declaration remains
nullable, even when the particular receiver occurrence is retagged non-null:

```haxe
final class Holder {
  final reader:Null<ReaderWithInline>;

  public function install():Void {
    reader.installBuilt(buildMarker());
  }
}

final class ReaderWithInline extends js.html.FileReader {
  public inline function installBuilt(_:Int):Void {
    this.onerror = function(error:js.lib.Error):Void {};
  }
}
```

The non-null assertion is valid in ordinary value code:

```ts
const _this: ReaderWithInline | null = this.reader;
_this!.onerror = function (error: globalThis.Error) {};
```

It is not valid inside a type query. This was the tempting but incorrect
combination of the nullable-read and host-callback fixes:

```ts
// Invalid TypeScript: `!` cannot appear in this type-query entity name.
_this!.onerror = Register.unsafeCast<typeof _this!.onerror>(
  function (error: globalThis.Error) {}
);
```

Genes now checks both the local declaration type and the particular read type
before planning `typeof local.field`. If either permits `null`, the host bridge
is not planned. The generated value-side `_this!.onerror` remains correct, and
strict TypeScript reports the original callback-signature mismatch instead of
Genes hiding it behind malformed generated syntax. That failure is deliberate:
the compiler does not yet have a sound non-evaluating type query for this
nullable receiver.

## How the rule stays narrow

The pre-emission boundary plan requires all of these compiler facts:

- the assignment target is an instance field on an exact `js.*` native extern;
- the Haxe extern field is the opaque `haxe.Constraints.Function`;
- the assigned value is a function literal;
- both the receiver declaration and this typed occurrence are non-null,
  non-unknown stable locals, so `typeof local.field` is a legal non-evaluating
  TypeScript type query;
- the field has no authored `@:ts.type` or `@:genes.type` contract.

The fixture also proves that a normal Haxe property, a concrete native callback,
a nullable local, both supported field type-override annotations, and a
callback reached through a method call receive no generic host bridge. Genes
does not implement general function variance, guess from the name `onerror`, or
copy a TypeScript DOM signature into the compiler.

The focused task also compiles the nullable inlining example separately and
expects strict TypeScript to reject its callback variance with `TS2322`. That
negative control proves Genes neither prints `typeof _this!.onerror` nor
silently broadens this rule to make every Haxe callback assignment compile.

Run the focused task with:

```sh
yarn test:host-callback-boundary
```
