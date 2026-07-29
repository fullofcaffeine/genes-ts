# Higher-order enum constructor type arguments

This dependency-free fixture covers a generic Haxe enum constructor used as a
function value. “Higher-order” means a function is passed to another function;
it does not change runtime behavior.

Haxe can determine enum parameters from the receiving function type even when
one constructor payload does not mention every parameter:

```haxe
enum Choice<A, B> {
  Left(value:A);
  Right(value:B);
}

return first(
  map(left, Choice.Left),
  map(right, Choice.Right)
);
```

The Haxe typed AST gives both mapped values the exact element type
`Choice<A,B>`. A bare TypeScript constructor reference cannot recover the
parameter absent from its own payload, however:

```ts
// Left infers Choice<A, never>; Right infers Choice<never, B>.
return first(
  map(left, Choice.Left),
  map(right, Choice.Right)
);
```

Genes must carry Haxe's already-checked destination into TypeScript:

```ts
return first(
  map(left, Choice.Left<A, B>),
  map(right, Choice.Right<A, B>)
);
```

The `<A, B>` portion is a TypeScript instantiation expression. It selects the
generic function type but emits no JavaScript, performs no cast, and does not
call the constructor early.

Run the focused task with:

```sh
yarn test:higher-order-enum-constructors
```
