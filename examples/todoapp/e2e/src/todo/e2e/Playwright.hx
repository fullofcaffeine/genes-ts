package todo.e2e;

import js.lib.Promise;
import todo.e2e.PlaywrightApi.test;
import todo.e2e.PlaywrightApi.TestArgs;
import todo.e2e.PlaywrightTypes.Page;

class PW {
  public static function testPage(name: String,
      fn: Page->Promise<Void>): Void {
    test(name, (args: TestArgs) -> fn(args.page));
  }
}
