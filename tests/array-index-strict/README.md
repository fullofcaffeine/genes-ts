# Strict array-index differential

This fixture compiles one consumer-neutral Haxe program through TypeScript
source, classic Genes ESM, and standard Haxe JavaScript. The TypeScript lane
enables `noUncheckedIndexedAccess` over every generated module.

The proof distinguishes three Haxe contracts:

- `Array<T>` reads remain the typed `T` selected by the Haxe compiler;
- `Array<Null<T>>` reads normalize JavaScript absence to Haxe `null`; and
- `Array<Undefinable<T>>` reads preserve their explicit TypeScript
  `undefined` union.

It also verifies that ordinary assignment targets are not decorated with a
read-only TypeScript assertion and that classic/standard runtime behavior does
not change.
