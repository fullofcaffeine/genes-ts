package todo.shared;

/**
 * Small shared helper used by the todoapp harness to prove:
 *
 * 1) genes-ts keeps *value* exports strongly typed (not just `type` exports), and
 * 2) we can interop in both directions:
 *    - TypeScript can import and call a Haxe-emitted value (`TodoText.interopBanner`)
 *    - Haxe can import and call a TS-authored function that calls back into Haxe.
 *
 * This is intentionally simple and deterministic so it is stable in snapshots and
 * easy to exercise in Playwright.
 */
class TodoText {
  public static function interopBanner(): String {
    return "interop: ts-imports-haxe-ok";
  }
}

