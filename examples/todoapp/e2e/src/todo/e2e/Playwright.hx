package todo.e2e;

import js.Syntax;
import js.lib.Promise;
import todo.e2e.PlaywrightApi.test;

class PW {
  public static function testPage(name: String,
      fn: Dynamic->Promise<Dynamic>): Void {
    // Playwright requires fixture args to be object-destructured.
    final cb: Dynamic = untyped Syntax.code("({ page }: any) => {0}(page)", fn);
    test(name, cb);
  }
}
