import { assert, assertEqual, assertStringEqual } from "./assert.js";
import { normalizeBaseUrl, type Config, type Role } from "./config.js";
import { TodoStatus, TodoStore } from "./todo.js";

export function main(): void {
  const role: Role = "admin";
  assert(role === "admin", "role union works");

  const cfg: Config = { role, dryRun: false };
  assertStringEqual(normalizeBaseUrl(cfg), "http://localhost", "default base url");

  const store = new TodoStore();
  const a = store.add("A", { priority: 10 });
  assertEqual(a.priority, 5, "priority clamped");
  const b = store.add("B", {});
  assertEqual(b.priority, 1, "default priority");

  const activeTitles = store.titlesByStatus(TodoStatus.Active);
  assertEqual(activeTitles.length, 2, "two active titles");

  store.toggle(a.id);
  const doneTitles = store.titlesByStatus(TodoStatus.Done);
  assertEqual(doneTitles.length, 1, "one done title");
  assertStringEqual(doneTitles[0]!, "A", "done title");

  let threw = false;
  try {
    store.toggle(999);
  } catch {
    threw = true;
  }
  assert(threw, "toggle missing throws");

  console.log("ROUNDTRIP_ADV_OK");
}

