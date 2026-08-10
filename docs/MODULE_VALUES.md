# Direct module values

`@:genes.moduleValue("name")` emits one Haxe module-level `final` as an ESM
`const`. The feature works in TypeScript and classic JavaScript output.

Use this feature when native code or a host analyzer needs a value at module
scope. The annotation changes the output shape. It does not change the value's
meaning or add a runtime.

## Example

```haxe
package catalog;

typedef CatalogMetadata = {
  final title:String;
  final tags:Array<String>;
}

@:genes.moduleValue("metadata")
final metadata:CatalogMetadata = {
  title: "Products",
  tags: ["typed", "esm"]
};

@:genes.moduleValue("metadataAlias")
final metadataAlias = metadata;
```

TypeScript output:

```ts
export type CatalogMetadata = {
  tags: string[];
  title: string;
};

export const metadata: CatalogMetadata = {
  "title": "Products",
  "tags": ["typed", "esm"]
};

export const metadataAlias: CatalogMetadata = metadata;
```

Classic JavaScript output:

```js
export const metadata = {
  "title": "Products",
  "tags": ["typed", "esm"]
};

export const metadataAlias = metadata;
```

Classic declaration output keeps the closed Haxe type:

```ts
export const metadata: CatalogMetadata;
export const metadataAlias: CatalogMetadata;
```

The output has no generated class, wrapper, registry, or value copy.

## Why the data rule is small

A JavaScript `const` initializer runs when its module loads. A function body
does not run until code calls the function.

This difference matters when one value reads a later value:

```ts
export const first = second;
export const second = 2;
```

JavaScript creates both names before it evaluates the first line. However, the
value of `second` is not available until the second line runs. Reading it early
throws `ReferenceError`.

Genes avoids this delayed runtime error. It accepts only these initializer
parts:

- primitive constants, including `null`;
- nested array literals;
- nested object literals;
- parentheses;
- an exact reference to an earlier selected value in the same Haxe module.

Haxe can add an erased wrapper while it checks an object against a structural
type. Genes accepts that wrapper only when the inner object follows the same
closed-data rules.

Genes rejects calls, constructors, operators, local variables, function
values, control flow, property reads, enum values, imported values, explicit
runtime casts, and references to later selected values. These expressions can
run code or depend on initialization order.

For a computed result, use a direct module function:

```haxe
@:genes.moduleFunction("getMetadata")
function getMetadata():CatalogMetadata {
  return loadMetadata();
}
```

## Source rules

The first release has these rules:

- The declaration must be a genuine Haxe module-level `final`.
- The annotation name must equal the Haxe field name.
- The name must be a valid, non-reserved ESM identifier.
- The value must have a retained initializer.
- Every retained field on the same compiler-created owner must use a direct
  function or value annotation.
- The Haxe module must not have a module initialization block.

Class static values are not supported. A class static value has real class
identity, so moving it would change the Haxe API.

```haxe
class Configuration {
  // Keep this as Configuration.metadata.
  public static final metadata = {title: "Products"};
}
```

The annotation does not keep dead code alive. A host macro that needs the
value must retain it through its normal typed contract.

## Errors and safe output

An unsupported initializer fails with this code:

```text
GENES-MODULE-VALUE-CLOSED-001
```

The message points to the unsupported Haxe expression. Genes reports other
shape and name errors at the annotation or declaration.

Genes checks the complete plan before it publishes output. A failed build
keeps the previous generated tree unchanged.

## Verification

Run the focused owner:

```sh
yarn test:module-functions
```

This test covers TypeScript, TSX, classic JavaScript, declarations, source
maps, runtime imports, dead-code removal, deterministic output, and exact
negative errors. It also checks that failed generation does not replace good
output.

See [`MODULE_FUNCTIONS.md`](MODULE_FUNCTIONS.md) for direct module functions.
