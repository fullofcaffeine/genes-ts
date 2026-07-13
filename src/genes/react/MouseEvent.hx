package genes.react;

/**
 * Type-only React mouse-event boundary for generated TypeScript/TSX.
 *
 * Why: React uses a synthetic mouse event rather than the browser's native
 * event class, and ts2hx must retain the element type parameter on handlers.
 *
 * What: the extern exposes the stable operation needed by migrated handlers.
 *
 * How: genes-ts projects the generic extern to React's canonical imported type;
 * no runtime value, cast, or dynamic storage is introduced.
 */
@:ts.type("import('react').MouseEvent<$0>")
extern class MouseEvent<T> {
  public function preventDefault(): Void;
}
