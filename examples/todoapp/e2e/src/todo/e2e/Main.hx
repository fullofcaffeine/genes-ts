package todo.e2e;

import js.Node;
import js.lib.RegExp;
import js.lib.Error;
import todo.e2e.Playwright.PW;
import todo.e2e.PlaywrightTypes.ConsoleMessage;
import todo.e2e.PlaywrightTypes.Page;

class Main {
  static function main() {
    PW.testPage("todoapp: create, navigate, update, toggle, delete", (page: Page) -> {
      final baseUrl = switch Node.process.env.get("BASE_URL") {
        case null: "http://localhost:8787";
        case v: v;
      }

      // Debug helpers: surface browser failures in CI logs.
      page.on("pageerror", (err: Error) -> {
        Node.console.error("[pageerror]", err);
      });
      page.on("console", (msg: ConsoleMessage) -> {
        Node.console.log("[console]", msg.type(), msg.text());
      });

      return page.goto(baseUrl + "/")
        .then(_ -> page.getByPlaceholder("New todo").fill("Buy milk"))
        .then(_ -> page.getByRole("button", {name: "Add"}).click())
        .then(_ -> page.getByText("Buy milk").count())
        .then(count -> {
          if (count != 1)
            throw 'Expected 1 todo in list, got $count';
        })
        .then(_ -> page.getByText("Buy milk").click())
        .then(_ -> page.waitForURL(new RegExp("/todos/"), {waitUntil: "commit"}))
        .then(_ -> {
          final url = page.url();
          if (url.indexOf("/todos/") == -1)
            throw 'Expected /todos/:id URL, got ' + url;
        })
        // Detail page has exactly one <input>; reuse it to update the title.
        .then(_ -> page.locator("input").fill("Buy oat milk"))
        .then(_ -> page.getByRole("button", {name: "Save"}).click())
        .then(_ -> page.waitForURL(baseUrl + "/", {waitUntil: "commit"}))
        .then(_ -> page.getByText("Buy oat milk").waitFor())
        .then(_ -> page.getByText("Buy oat milk").count())
        .then(count -> {
          if (count != 1)
            throw 'Expected updated todo title in list, got $count';
        })
        .then(_ -> page.locator('input[type=\"checkbox\"]').nth(0).click())
        .then(_ -> page.locator('input[type=\"checkbox\"]').nth(0).isChecked())
        .then(checked -> {
          if (!checked)
            throw "Expected first todo checkbox to be checked";
        })
        .then(_ -> page.getByRole("button", {name: "Delete"}).nth(0).click())
        .then(_ -> page.getByText("Buy oat milk").count())
        .then(count -> {
          if (count != 0)
            throw 'Expected todo to be deleted, but count was $count';
        });
    });
  }
}
