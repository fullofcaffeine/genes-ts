package todo.e2e;

import genes.js.Async.await;
import js.Syntax;
import js.lib.Promise;
import js.lib.RegExp;
import js.lib.Error;
import todo.e2e.Playwright.PW;
import todo.e2e.PlaywrightTypes.ConsoleMessage;
import todo.e2e.PlaywrightTypes.Page;

class Main {
  static function sleep(ms: Int): Promise<Void> {
    return cast Syntax.code("new Promise(resolve => setTimeout(resolve, {0}))", ms);
  }

  @:async
  static function waitForChecked(locator: todo.e2e.PlaywrightTypes.Locator, timeoutMs: Int): Promise<Void> {
    final start = haxe.Timer.stamp();
    while (true) {
      final checked = await(locator.isChecked());
      if (checked)
        return;
      if ((haxe.Timer.stamp() - start) * 1000 > timeoutMs)
        throw "Expected first todo checkbox to be checked";
      await(sleep(50));
    }
  }

  @:async
  static function waitForCount(locator: todo.e2e.PlaywrightTypes.Locator, expected: Int, timeoutMs: Int): Promise<Void> {
    final start = haxe.Timer.stamp();
    while (true) {
      final count = await(locator.count());
      if (count == expected)
        return;
      if ((haxe.Timer.stamp() - start) * 1000 > timeoutMs)
        throw 'Expected count $expected, got $count';
      await(sleep(50));
    }
  }

  static function main() {
    PW.testPage("todoapp: validation + create, navigate, update, toggle, delete", @:async function(page: Page): Promise<Void> {
      // Typed access to Node globals without triggering `__js__` deprecation warnings.
      // See `todo.e2e.NodeGlobals` for the rationale and the exact warning text.
      final nodeProcess = NodeGlobals.process();
      final nodeConsole = NodeGlobals.console();

      final baseUrl = switch nodeProcess.env.get("BASE_URL") {
        case null: "http://localhost:8787";
        case v: v;
      }

      // Debug helpers: surface browser failures in CI logs.
      page.on("pageerror", (err: Error) -> {
        nodeConsole.error("[pageerror]", err);
      });
      page.on("console", (msg: ConsoleMessage) -> {
        nodeConsole.log("[console]", msg.type(), msg.text());
      });

      await(page.goto(baseUrl + "/"));
      await(page.getByText("interop: ts-imports-haxe-ok").waitFor());

      await(page.getByRole("button", {name: "Add"}).click());
      await(page.getByText("Title is required").waitFor());

      await(page.getByPlaceholder("New todo").fill("Buy milk"));
      await(page.getByRole("button", {name: "Add"}).click());
      await(waitForCount(page.getByText("Buy milk"), 1, 5000));

      await(page.getByText("Buy milk").click());
      await(page.waitForURL(new RegExp("/todos/"), {waitUntil: "commit"}));
      final url = page.url();
      if (url.indexOf("/todos/") == -1)
        throw 'Expected /todos/:id URL, got ' + url;

      // Detail page has exactly one <input>; reuse it to update the title.
      await(page.locator("input").fill("Buy oat milk"));
      await(page.getByRole("button", {name: "Save"}).click());
      await(page.waitForURL(baseUrl + "/", {waitUntil: "commit"}));

      await(page.getByText("Buy oat milk").waitFor());
      final count = await(page.getByText("Buy oat milk").count());
      if (count != 1)
        throw 'Expected updated todo title in list, got $count';

      await(page.locator('input[type=\"checkbox\"]').nth(0).click());
      await(waitForChecked(page.locator('input[type=\"checkbox\"]').nth(0), 5000));
      await(page.getByRole("button", {name: "Delete"}).nth(0).click());
      await(waitForCount(page.getByText("Buy oat milk"), 0, 5000));
    });

    PW.testPage("todoapp: deep-link refresh keeps detail state", @:async function(page: Page): Promise<Void> {
      final nodeProcess = NodeGlobals.process();
      final baseUrl = switch nodeProcess.env.get("BASE_URL") {
        case null: "http://localhost:8787";
        case v: v;
      }

      var detailUrl = "";

      await(page.goto(baseUrl + "/"));
      await(page.getByPlaceholder("New todo").fill("Deep link todo"));
      await(page.getByRole("button", {name: "Add"}).click());
      await(page.getByText("Deep link todo").waitFor());
      await(page.getByText("Deep link todo").click());
      await(page.waitForURL(new RegExp("/todos/"), {waitUntil: "commit"}));

      detailUrl = page.url();
      if (detailUrl.indexOf("/todos/") == -1)
        throw 'Expected /todos/:id URL, got ' + detailUrl;

      // Refresh by navigating directly to the same URL again.
      await(page.goto(detailUrl));
      final value = await(page.locator("input").inputValue());
      if (value != "Deep link todo")
        throw 'Expected detail title to persist after deep-link refresh, got ' + value;
    });

    PW.testPage("todoapp: invalid deep link shows error and can return home", @:async function(page: Page): Promise<Void> {
      final nodeProcess = NodeGlobals.process();
      final baseUrl = switch nodeProcess.env.get("BASE_URL") {
        case null: "http://localhost:8787";
        case v: v;
      }

      await(page.goto(baseUrl + "/todos/does-not-exist"));
      await(page.getByText("Todo not found").waitFor());
      await(page.getByRole("link", {name: "Back"}).click());
      await(page.waitForURL(baseUrl + "/", {waitUntil: "commit"}));
      await(page.getByText("Todoapp").waitFor());
    });
  }
}
