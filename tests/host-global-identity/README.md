# Host-global identity fixture

This fixture checks a name-collision problem at the boundary between Haxe and
generated TypeScript.

## Why this exists

`js.lib.Promise` and `js.lib.Error` mean JavaScript's built-in constructors.
That meaning comes from the Haxe compiler's typed declarations; it is not a
guess based on the words `Promise` and `Error`.

A Haxe program may also define unrelated classes with those names:

```haxe
class Promise {
  public static function marker():String {
    return "local-promise";
  }
}

class Error {
  public static function marker():String {
    return "local-error";
  }
}

function makePromise():js.lib.Promise<String> {
  return new js.lib.Promise(resolve -> resolve("ready"));
}
```

Inside one generated TypeScript module, an unqualified name refers to the local
class first. The old output could therefore describe the built-in promise with
the unrelated local class:

```ts
export class Promise {
  static marker(): string {
    return "local-promise";
  }
}

// Wrong: `Promise<string>` resolves to the non-generic class above.
function makePromise(): Promise<string> {
  return new Promise(resolve => resolve("ready"));
}
```

This is not a problem in the Haxe source. Haxe still knows the exact declaration
identity. The information was lost while Genes chose a TypeScript spelling, so
the correction belongs in Genes rather than in each generated application.

## What correct output means

Genes preserves local references as local and qualifies only exact JavaScript
host declarations:

```ts
export class Promise {
  static marker(): string {
    return "local-promise";
  }
}

function makePromise(): globalThis.Promise<string> {
  return new globalThis.Promise(resolve => resolve("ready"));
}
```

`globalThis.Promise` and `globalThis.Error` mean “the constructor on the
JavaScript global object.” A local declaration cannot capture those names.

The fixture covers both the type and runtime sides:

- parameter and return annotations;
- `new globalThis.Promise(...)` and `new globalThis.Error(...)`;
- static access such as `globalThis.Promise.resolve(...)`;
- class values and `instanceof`;
- a class extending the built-in `Error`;
- Haxe's own `haxe.Exception` superclass and cyclic runtime thunk;
- TypeScript implementation and declaration output;
- a negative control proving that user classes named `Promise` and `Error`
  remain ordinary local classes.

Haxe's JavaScript standard library contains private aliases for the built-in
`Error` constructor. For example, `haxe.Exception` extends a private
`@:native("Error")` extern. Genes recognizes that compiler-owned alias by exact
module identity. It does **not** assume that every user extern carrying
`@:native("Error")` refers to the same semantic declaration.

Classic Genes JavaScript keeps its established unqualified runtime spelling;
the change is for TypeScript-readable source and TypeScript declarations. The
standard Haxe JavaScript build acts as the runtime reference. The fixture does
not execute classic output under the deliberate same-module collision because
changing classic runtime name resolution is outside this focused contract.

## How to run it

```sh
yarn test:host-global-identity
```

The task:

1. compiles TypeScript-readable, classic Genes, and standard Haxe JavaScript;
2. checks the generated TypeScript with the pinned TypeScript 5, 6, and 7 lanes;
3. compares TypeScript-readable runtime behavior with standard Haxe JavaScript;
4. inspects implementation and declaration text for every supported position;
5. verifies that no host `Promise` or `Error` import was allocated;
6. verifies that source maps still point at the original Haxe expression.

The expected runtime line is:

```text
local-promise|local-error|host-error|true|true|true|true|true|resolved
```

Prepared by the GameCarry agent.
