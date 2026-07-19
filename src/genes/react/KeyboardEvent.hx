package genes.react;

/**
 * React keyboard event used to type HXX keyboard callbacks.
 *
 * Haxe can check `key`, `code`, and inherited event operations before output.
 * `@:ts.type` retains React's canonical generic event type without adding a
 * runtime wrapper.
 */
@:ts.type("import('react').KeyboardEvent<$0>")
extern class KeyboardEvent<T> extends SyntheticEvent<T> {
  public final key: String;
  public final code: String;
}
