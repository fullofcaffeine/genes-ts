package todo.e2e;

import js.Syntax;
import js.lib.Promise;
import todo.e2e.PlaywrightApi.test;
import todo.e2e.PlaywrightTypes.Page;

class PW {
  public static function testPage(name: String,
      fn: Page->Promise<Void>): Void {
    // Use object-destructuring to preserve Playwright's contextual typing in TS.
    test(name, Syntax.code("({ page }) => {0}(page)", fn));
  }
}
