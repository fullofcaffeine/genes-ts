# Nullable receivers stored in compiler temporaries

This fixture proves that Genes preserves one non-null fact already present in
Haxe's checked program when inline expansion introduces an evaluate-once
temporary. No knowledge of GameCarry or Tink is required. GameCarry's
`tink_core.ProgressTrigger` output supplied the larger program that exposed the
compiler gap.

## The practical problem

Consider a nullable receiver and an inline method:

```haxe
private class Target {
  final receiver:Null<Receiver>;

  public function pushBuilt(value:Int):Void {
    receiver.push(build(value));
  }
}

private class Receiver {
  public inline function push(value:Int):Void {
    values.push(value);
  }
}
```

Haxe accepts the call using its normal nullable-value rules. Because `push` is
inline and `build(value)` can have side effects, Haxe must preserve the source
evaluation order:

1. evaluate `receiver`;
2. evaluate `build(value)`;
3. perform the inlined array push.

The Haxe compiler represents that order with temporary locals. Conceptually,
the checked program now resembles:

```haxe
var temporary:Null<Receiver> = receiver;
var built:Int = build(value);
temporary.values.push(built);
```

There are two related but distinct types in Haxe's typed abstract syntax tree
(AST):

- the `TVar` declaration says `temporary` can hold `Null<Receiver>`;
- the exact later `TLocal` read is retagged as `Receiver`.

`TVar` and `TLocal` are names for nodes in Haxe's checked, structured
representation of the program. The important point is simply that Haxe keeps
the local variable nullable while proving one particular use has the plain
payload type.

Before this change, Genes emitted only the declaration-level fact:

```ts
const _this: Receiver | null = this.receiver;
const value1: number = this.build(value);
_this.values.push(value1);
//    ~~~~~~
// Error TS18047: '_this' is possibly 'null'.
```

The direct form did not fail because Genes already preserved the type attached
to the original field read:

```ts
(this.receiver!).values.push(value);
```

The inconsistency appeared only after Haxe introduced the temporary.

As an external pressure test, this focused rule reduces both the
package-neutral `tink_cli` fixture and the GameCarry CLI from 17 to 16 strict
TypeScript diagnostics. The removed diagnostic is exactly the nullable
temporary in `tink/core/Progress.ts`; the other unsupported diagnostics remain
visible. Those counts are downstream observations, not assumptions built into
this compiler-owned fixture.

## What Genes emits now

Genes records the exact retagged `TLocal` read in the immutable TypeScript
boundary plan. The emitter consumes that decision:

```ts
const _this: Receiver | null = this.receiver;
const value1: number = this.build(value);
_this!.values.push(value1);
```

The `!` is TypeScript's non-null assertion operator. It tells the TypeScript
checker to use `Receiver` for this one expression. It does not check, convert,
clone, or wrap the value, and it produces no JavaScript.

The binding intentionally remains `Receiver | null`. Genes is not claiming
that every read of `_this` is safe, and it is not changing later assignments.
It is carrying forward only the read-level type Haxe already attached to this
exact AST node.

The executable JavaScript is unchanged:

```js
const _this = this.receiver;
const value1 = this.build(value);
_this.values.push(value1);
```

That unchanged sequence also proves that the receiver and side-effectful
argument are each evaluated once and in the same order as before.

## Why the rule is deliberately narrow

Genes records the assertion only when all of these facts hold:

1. the expression is an exact local-variable read;
2. the local declaration permits Haxe `null`;
3. the read itself no longer permits Haxe `null`;
4. removing only the declaration's outer Haxe `Null` produces the exact read
   type, including the same class and generic arguments;
5. the types are not `Dynamic`, `Unknown`, `Undefinable`, or unresolved; and
6. Genes's existing flow plan has not already proved the read non-null.

This is not a general assumption that nullable locals are present. The fixture
includes an ordinary local that is assigned `null` and returned:

```haxe
public function clearLocal(value:Null<Receiver>):Null<Receiver> {
  var local = value;
  local = null;
  return local;
}
```

Its generated TypeScript remains honestly nullable, without `local!`:

```ts
let local: Receiver | null = value;
local = null;
return local;
```

No assertion target type is printed, so this decision introduces no import or
runtime-helper dependency. Assignment targets are also never rendered with
the read assertion.

## Validation

Run the task-specific test:

```sh
yarn test:nullable-temp-receivers
```

It verifies:

- strict output with the pinned TypeScript 5, 6, and 7 lanes;
- exact generated TypeScript for the temporary and direct paths;
- the reassigned nullable-local negative control;
- identical TypeScript-readable, classic, and standard-JavaScript runtime
  transcripts;
- evaluate-once behavior through the observable `buildCount`; and
- source-map ownership of `_this!` by the authored Haxe call.

Prepared by the GameCarry agent.
