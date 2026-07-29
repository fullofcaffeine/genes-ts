# Reflected Haxe class values and JavaScript `Function`

This package-neutral fixture compiles one Haxe program through Genes
TypeScript, classic Genes JavaScript, and standard Haxe JavaScript.

## What problem this reproduces

Haxe reflection lets a program ask for an object's class and resolve a class
by its Haxe name:

```haxe
final instance = new Calculator();
final reflected = Type.getClass(instance);
final resolved = Type.resolveClass("example.Calculator");
```

To support those public Haxe APIs, Genes emits runtime metadata such as
`__class__`, `__super__`, and `__interfaces__`, and registers each class in the
`$hxClasses` lookup table. These are generated implementation details; the
application author does not write them.

At runtime, a JavaScript class constructor is a Function object. Haxe can also
give the same class an ordinary domain method named `apply`, `call`, `bind`, or
`toString`:

```haxe
class Calculator {
  public static function apply(
    left:Int,
    middle:Int,
    right:Int
  ):Int {
    return left + middle + right;
  }
}
```

That method is valid Haxe and JavaScript. It is unrelated to JavaScript's
built-in `Function.apply`. The two APIs merely share a property name.

## Why strict TypeScript rejects the generated metadata

TypeScript uses structural typing here: it compares properties with the same
name and checks whether their signatures are compatible. Its built-in
`Function.apply` declares two positional parameters: the first is required and
the second is optional:

```ts
interface Function {
  apply(thisArg: any, argArray?: any): any;
}
```

TypeScript's structural method comparison accepts a class `apply` method with
up to two required positions here. A class method that requires a third
position cannot satisfy the built-in shape because the `Function` contract
exposes no third position.

The Haxe class above generates a three-parameter static method:

```ts
class Calculator {
  static apply(
    left: number,
    middle: number,
    right: number
  ): number {
    return left + middle + right;
  }
}
```

JavaScript still treats `Calculator` as a real Function object, but TypeScript
no longer considers `typeof Calculator` structurally assignable to its
`Function` interface. Before this fix, Genes generated reflection code like:

```ts
class Calculator {
  get __class__(): Function {
    return Calculator;
  }
}

Register.setHxClass("example.Calculator", Calculator);
```

Strict TypeScript reports both generated uses:

```text
TS2322: Type 'typeof Calculator' is not assignable to type 'Function'.
TS2345: Argument of type 'typeof Calculator' is not assignable to
        parameter of type 'Function'.
```

These are not incompatible Haxe types from the application. Haxe accepted the
source because it never asked the application to pass `Calculator` as a
user-authored `Function`. The mismatch appears only where Genes adds
TypeScript-typed runtime reflection metadata.

## How Genes bridges the exact runtime boundary

Genes examines the compiler's typed class and inherited static fields before
printing a reflected class value. When an emitted static signature conflicts
with the reviewed JavaScript Function surface, the TypeScript profile states
the already-known runtime identity at that boundary:

```ts
class Calculator {
  get __class__(): Function {
    return Register.unsafeCast<Function>(Calculator);
  }
}

Register.setHxClass(
  "example.Calculator",
  Register.unsafeCast<Function>(Calculator)
);
```

`Register.unsafeCast<Function>` is an identity operation. It returns the exact
same `Calculator` constructor reference; it does not rename a method, wrap the
class, clone it, perform validation, or change JavaScript behavior. The
explicit type argument tells TypeScript how Genes' reflection runtime uses
that value.

The emitted JavaScript therefore preserves the original class value:

```js
class Calculator {
  get __class__() {
    return Register.unsafeCast(Calculator);
  }
}

Register.setHxClass(
  "example.Calculator",
  Register.unsafeCast(Calculator)
);
```

The remaining identity call also returns `Calculator` unchanged. Genes classic
JavaScript is intentionally not changed and continues to emit its existing
direct reflection wiring:

```js
get __class__() {
  return Calculator;
}
```

## Why the bridge is selective

Genes does not cast every class, every static method, or every shared name.
For example, these shapes remain directly assignable:

```haxe
class Compatible {
  public static function toString():String {
    return "Compatible";
  }

  public static function apply(left:Int, right:Int):Int {
    return left + right;
  }
}
```

Their generated metadata stays simple:

```ts
get __class__(): Function {
  return Compatible;
}
```

Keeping compatible classes direct preserves useful structural checking. It
also prevents this narrow compiler-owned reflection rule from turning into a
general-purpose way to hide unrelated TypeScript errors.

The effective emitted surface also includes overloads and normal JavaScript
static hiding:

```haxe
class Overloaded {
  @:overload(function(a:Int, b:Int, c:Int):Int {})
  public static function apply(a:Int, b:Int):Int {
    return a + b;
  }
}

class Parent {
  public static function apply(a:Int, b:Int, c:Int):Int {
    return a + b + c;
  }
}

class Child extends Parent {
  // This own property hides Parent.apply on the Child class value.
  public static function apply(a:Int, b:Int):Int {
    return a + b;
  }
}
```

`Overloaded` needs a bridge because TypeScript exposes its incompatible
three-argument overload. `Parent` needs a bridge too. `Child` remains direct
because its own compatible `apply` is the effective property on the child
constructor; independently, the generated `Child.__super__` getter bridges the
actual `Parent` value.

The relevant generated TypeScript therefore has three distinct outcomes:

```ts
class Overloaded {
  static apply(a: number, b: number, c: number): number;

  get __class__(): Function {
    return Register.unsafeCast<Function>(Overloaded);
  }
}

class Parent {
  static apply(a: number, b: number, c: number): number;
}

class Child extends Parent {
  static apply(a: number, b: number): number;

  static get __super__(): Function {
    return Register.unsafeCast<Function>(Parent);
  }

  get __class__(): Function {
    return Child;
  }
}
```

## What the fixture proves

The fixture includes incompatible `toString` and three-argument `apply`
signatures; compatible zero-argument `toString`, two-argument `apply`, `call`,
and `bind` controls; a non-function `call` property; `@:native` examples where
the emitted name creates or removes a collision; an incompatible overload; an
inherited collision; a child that hides an inherited collision; an implemented
interface; and an ordinary class with no collision. A shared Haxe name does
not by itself authorize a bridge: the effective emitted name and typed
signature must conflict, while compatible controls remain directly typed. All
three output profiles must print the same runtime transcript.
