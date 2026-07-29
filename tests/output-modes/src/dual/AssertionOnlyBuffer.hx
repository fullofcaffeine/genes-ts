package dual;

/**
 * External type named only by an `assumePresent()` assertion.
 *
 * Its `@:jsRequire` metadata gives dependency planning a real type-only ESM
 * binding to retain. The fixture never constructs or reads the Node value, so
 * classic runtime output must not gain an import.
 */
@:jsRequire("node:buffer", "Buffer")
extern class AssertionOnlyBuffer {
  public final length: Int;
}
