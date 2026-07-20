package genes.react;

/** Cleanup function React 19 permits a callback ref to return. */
typedef RefCleanup = Void->Void;

/**
 * Checked callback form of a React ref.
 *
 * Why: Hooks and headless component libraries commonly return callback refs
 * that must be attached to intrinsic elements. Treating `ref` as an open
 * property would postpone an invalid element target or callback result until
 * TypeScript, after HXX has already claimed the markup is sound.
 *
 * What: React calls the callback with the mounted element or `null` during
 * cleanup. React 19 also permits the callback to return a cleanup function.
 *
 * How: this ordinary Haxe function type participates in contextual HXX
 * checking. The closed result union is projected as
 * `void | (() => void)` by `OneOf2`; it creates no runtime wrapper.
 */
typedef RefCallback<T> = Null<T>->OneOf2<Void, RefCleanup>;

/**
 * Type-only view of React's mutable ref object.
 *
 * Why: intrinsic `ref` accepts both callback refs and objects created by React
 * APIs. The Haxe view exposes only the one reviewed field instead of an open
 * structural carrier.
 *
 * What: `current` is the mounted element or `null`.
 *
 * How: `@:ts.type` prints React's canonical `RefObject<T | null>` import type
 * in TypeScript and erases from classic JavaScript; no class is emitted.
 */
@:ts.type("import('react').RefObject<$0 | null>")
extern class RefObject<T> {
  public var current: Null<T>;
}

/**
 * Closed intrinsic-ref contract supported by the default React HXX provider.
 *
 * The outer `Null` models React's explicit `null` ref. Omission remains a
 * separate property-presence fact supplied by `@:optional` on the intrinsic
 * property itself.
 */
typedef ReactRef<T> = Null<OneOf2<RefCallback<T>, RefObject<T>>>;
