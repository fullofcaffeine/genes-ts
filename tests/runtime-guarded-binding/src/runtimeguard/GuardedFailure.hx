package runtimeguard;

/**
 * Enum value used to prove Haxe's opaque `js.Boot.__instanceof` catch guard.
 *
 * Haxe enums are runtime objects, but TypeScript cannot infer their type from
 * the Boolean-returning helper that Haxe uses while lowering a typed catch.
 */
enum GuardedFailure {
  Rejected(message: String);
}
