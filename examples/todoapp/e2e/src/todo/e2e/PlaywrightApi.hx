package todo.e2e;

import js.lib.Promise;
import todo.e2e.PlaywrightTypes.Page;

typedef TestArgs = {
  final page: Page;
}

@:jsRequire("@playwright/test", "test")
extern function test(name: String, fn: TestArgs->Promise<Void>): Void;
