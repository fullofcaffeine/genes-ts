package ts2hx;

import ts2hx.Assert.assert;
import ts2hx.Assert.assertEqual;
import ts2hx.Assert.assertStringEqual;
import ts2hx.Config.normalizeBaseUrl;
import ts2hx.Config;
import ts2hx.Config.Role;
import ts2hx.Todo.TodoStatus;
import ts2hx.Todo.TodoStore;

function main(): Void {
  var role: Role = "admin";
  assert((role == "admin"), "role union works");
  var cfg: Config = { role: role, dryRun: false };
  assertStringEqual(normalizeBaseUrl(cfg), "http://localhost", "default base url");
  var store = new TodoStore();
  var a = store.add("A", { priority: 10 });
  assertEqual(a.priority, 5, "priority clamped");
  var b = store.add("B", {  });
  assertEqual(b.priority, 1, "default priority");
  var activeTitles = store.titlesByStatus(TodoStatus.Active);
  assertEqual(activeTitles.length, 2, "two active titles");
  store.toggle(a.id);
  var doneTitles = store.titlesByStatus(TodoStatus.Done);
  assertEqual(doneTitles.length, 1, "one done title");
  assertStringEqual((doneTitles[0]), "A", "done title");
  var threw = false;
  try {
    store.toggle(999);
  } catch (e: Dynamic) {
    threw = true;
  }
  assert(threw, "toggle missing throws");
  trace("ROUNDTRIP_ADV_OK");
}
