package todo.e2e;

import js.Syntax;
import js.lib.Promise;
import todo.e2e.PlaywrightApi.test;
import todo.e2e.PlaywrightApi.TestArgs;
import todo.e2e.PlaywrightTypes.Page;

class PW {
  public static function testPage(name: String,
      fn: Page->Promise<Void>): Void {
    // Playwright requires the test callback's first argument to use object
    // destructuring (e.g. `({ page }) => ...`) so fixtures are detected at runtime.
    // Haxe cannot express JS destructuring, so we inject it via `js.Syntax.code`.
    final cb: TestArgs->Promise<Void> = cast Syntax.code("({ page }) => fn(page)");
    test(name, cb);
  }
}
