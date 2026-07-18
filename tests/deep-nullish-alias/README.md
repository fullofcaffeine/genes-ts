# Long type-alias and null/undefined test

## What this test protects

A Haxe `typedef` gives an existing type another name. Projects often use these
aliases to make APIs easier to understand—for example, `UserName` may still be
a `String`. One alias may refer to another, creating an alias chain.

Genes must follow that chain without forgetting whether the final value is:

- always present;
- allowed to be Haxe `null`; or
- allowed to be JavaScript `undefined`.

The last two values are sometimes called *nullish values*. They are related,
but they are not interchangeable in every Haxe or JavaScript operation.

## Why the chain has 66 links

The compiler includes a safety limit that prevents an unexpected recursive
type from making code generation loop forever. That limit is 64 steps. Normal,
valid aliases should be resolved before the safety limit is relevant, so this
fixture goes just beyond it with 66 links and confirms that valid application
types remain precise.

The test uses the same long chain for `String`, `Null<String>`, and
`genes.ts.Undefinable<String>`. It then places those types in public object
fields, function parameters and results, and `StringMap` reads. This covers
both the generated API and runtime behavior.

## What runs

The same Haxe source runs in three profiles:

1. standard Haxe JavaScript;
2. classic Genes JavaScript with declarations; and
3. Genes TypeScript output.

External TypeScript programs also compile against the generated public API on
the supported TypeScript 5, 6, and 7 lanes. The aliases remain public in this
fixture so those programs inspect the real chain rather than a simplified copy.

Run the focused evidence with:

```bash
yarn test:deep-nullish-alias
```

Passing this test does not mean the safety limit should be removed. It shows
that the limit protects the compiler from malformed internal types without
weakening ordinary aliases written by users.

See also: [`DeepNullishAliases.hx`](src/deepnullish/DeepNullishAliases.hx)
contains the tested aliases and explains each expected result next to the code.
