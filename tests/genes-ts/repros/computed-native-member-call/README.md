# computed-native-member-call repro

Expected-failing reduction for `genes-bkm`.

`@:native("[Symbol.asyncIterator]")` correctly emits a computed method definition,
but calling that method from Haxe currently emits invalid TypeScript:

```ts
stream.[Symbol.asyncIterator]().next()
```

The call should emit:

```ts
stream[Symbol.asyncIterator]().next()
```

