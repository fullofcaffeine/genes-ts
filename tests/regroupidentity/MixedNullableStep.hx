package tests.regroupidentity;

/**
 * Structurally mixed nullable/plain generic payload used by the cast guard.
 *
 * An unchanged `MixedNullable<T>` contains both `Null<T>` and plain `T`.
 * Merely finding those two spellings must not make the TypeScript emitter add
 * a compatibility assertion; only a corresponding `T` to `Null<T>` change is
 * eligible.
 */
class MixedNullable<T> {
  public final nullable:Null<T>;
  public final plain:T;

  public function new(nullable:Null<T>, plain:T) {
    this.nullable = nullable;
    this.plain = plain;
  }
}

/**
 * Destination-typed enum constructor used to exercise the no-cast boundary.
 */
enum MixedNullableStep<T> {
  Mixed(value:MixedNullable<T>);
}
