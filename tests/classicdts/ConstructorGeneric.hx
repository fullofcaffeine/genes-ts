package tests.classicdts;

/**
 * Isolates constructor-local enum generics for classic declaration testing.
 *
 * The `Payload<T>` constructor proves that a type parameter introduced by one
 * constructor remains attached to its payload in emitted `.d.ts` output. The
 * module intentionally has no library dependencies, allowing the external
 * TypeScript consumer to test this compiler contract without pulling in the
 * unrelated unit-test harness declaration graph.
 */
@:keep
enum ConstructorGeneric<A, B> {
  Payload<T>(left: A, right: B, value: T):ConstructorGeneric<T, T>;
}
