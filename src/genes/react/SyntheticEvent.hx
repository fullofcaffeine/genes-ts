package genes.react;

/**
 * Shared Haxe contract for React's cross-browser event wrapper.
 *
 * Why: callbacks should be useful and checked in Haxe, not left as an untyped
 * value until TypeScript runs. `T` records the element receiving the event.
 *
 * What: this extern exposes the common safe operations and a read-only
 * `currentTarget`. The target parameter is intentionally never accepted by a
 * setter or method in this reviewed event family. That lets HXX safely pass a
 * specific target event to a handler that accepts a real target superclass.
 *
 * How: `@:ts.type` prints React's real `SyntheticEvent<T>` type and emits no
 * runtime class or conversion. If a future facade consumes `T` as an input,
 * its HXX variance rule must be reviewed at the same time.
 */
@:ts.type("import('react').SyntheticEvent<$0>")
extern class SyntheticEvent<T> {
  public final currentTarget: T;
  public function preventDefault(): Void;
  public function stopPropagation(): Void;
}
