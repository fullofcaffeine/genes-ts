package todo.e2e;

import js.Syntax;
import js.lib.RegExp;
import todo.e2e.Playwright.PW;

class Main {
  static function main() {
    PW.testPage("todoapp: create, navigate, update, toggle, delete", (page: Dynamic) -> {
      final baseUrl: String = cast Syntax.code("process.env.BASE_URL || 'http://localhost:8787'");

      // Debug helpers: surface browser failures in CI logs.
      untyped page.on("pageerror", (err) -> {
        Syntax.code("console.error('[pageerror]', {0})", err);
      });
      untyped page.on("console", (msg) -> {
        Syntax.code("console.log('[console]', {0}.type(), {0}.text())", msg);
      });

      return untyped page.goto(baseUrl + "/").then(_ -> {
        return untyped page.getByPlaceholder("New todo").fill("Buy milk");
      }).then(_ -> {
        return untyped page.getByRole("button", {name: "Add"}).click();
      }).then(_ -> {
        return untyped page.getByText("Buy milk").count().then(count -> {
          if (count != 1)
            throw 'Expected 1 todo in list, got $count';
          return null;
        });
      }).then(_ -> {
        return untyped page.getByText("Buy milk").click();
      }).then(_ -> {
        return untyped page.waitForURL(new RegExp("/todos/"), {waitUntil: "commit"});
      }).then(_ -> {
        final url: String = cast untyped page.url();
        if (url.indexOf("/todos/") == -1)
          throw 'Expected /todos/:id URL, got ' + url;
        return null;
      }).then(_ -> {
        // Detail page has exactly one <input>; reuse it to update the title.
        return untyped page.locator("input").fill("Buy oat milk");
      }).then(_ -> {
        return untyped page.getByRole("button", {name: "Save"}).click();
      }).then(_ -> {
        return untyped page.waitForURL(baseUrl + "/", {waitUntil: "commit"});
      }).then(_ -> {
        return untyped page.getByText("Buy oat milk").waitFor().then(_ -> {
          return untyped page.getByText("Buy oat milk").count().then(count -> {
            if (count != 1)
              throw 'Expected updated todo title in list, got $count';
            return null;
          });
        });
      }).then(_ -> {
        return untyped page.locator('input[type=\"checkbox\"]').nth(0).click();
      }).then(_ -> {
        return untyped page.locator('input[type=\"checkbox\"]').nth(0).isChecked().then(checked -> {
          if (!checked)
            throw "Expected first todo checkbox to be checked";
          return null;
        });
      }).then(_ -> {
        return untyped page.getByRole("button", {name: "Delete"}).nth(0).click();
      }).then(_ -> {
        return untyped page.getByText("Buy oat milk").count().then(count -> {
          if (count != 0)
            throw 'Expected todo to be deleted, but count was $count';
          return null;
        });
      });
    });
  }
}
