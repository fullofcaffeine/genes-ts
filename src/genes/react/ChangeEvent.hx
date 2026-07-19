package genes.react;

/**
 * Type-only React change-event contract for form-control HXX properties.
 *
 * Why: React refines a change event's target to the originating element.
 * Keeping that relationship in Haxe lets callbacks use fields such as
 * `event.target.value` before any TypeScript output exists.
 *
 * What: `target` has the same `T` selected by the intrinsic property schema.
 *
 * How: `@:ts.type` preserves React's canonical `ChangeEvent<T>` spelling. The
 * extern and its field are compile-time contracts; no runtime object is added.
 */
@:ts.type("import('react').ChangeEvent<$0>")
extern class ChangeEvent<T> extends SyntheticEvent<T> {
  public final target: T;
}
