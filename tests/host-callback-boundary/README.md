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

## How the rule stays narrow

The pre-emission boundary plan requires all of these compiler facts:

- the assignment target is an instance field on an exact `js.*` native extern;
- the Haxe extern field is the opaque `haxe.Constraints.Function`;
- the assigned value is a function literal;
- the receiver is a non-null, non-unknown stable local, so
  `typeof local.field` is a legal non-evaluating TypeScript type query;
- the field has no authored `@:ts.type` or `@:genes.type` contract.

The fixture also proves that a normal Haxe property, a concrete native callback,
a nullable local, both supported field type-override annotations, and a
callback reached through a method call receive no generic host bridge. Genes
does not implement general function variance, guess from the name `onerror`, or
copy a TypeScript DOM signature into the compiler.

Run the focused task with:

```sh
yarn test:host-callback-boundary
```
