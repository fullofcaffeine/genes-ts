package genes.react;

/**
 * Shared Haxe contract for React's cross-browser event wrapper.
 *
 * Why: callbacks should be useful and checked in Haxe, not left as an untyped
 * value until TypeScript runs. `T` records the element receiving the event.
 *
 * How: this extern exposes the common safe operations and `currentTarget`.
 * `@:ts.type` prints React's real `SyntheticEvent<T>` type and emits no runtime
 * class or conversion.
 */
@:ts.type("import('react').SyntheticEvent<$0>")
extern class SyntheticEvent<T> {
  public final currentTarget: T;
  public function preventDefault(): Void;
  public function stopPropagation(): Void;
}
