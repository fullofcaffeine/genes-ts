import { assert, assertEqual, assertStringEqual } from "./assert.js";
import { TodoStatus, TodoStore } from "./todo.js";

export function main(): void {
  const store = new TodoStore();

  assertEqual(store.list().length, 0, "initial list empty");

  const a = store.add("Buy milk");
  assertEqual(a.id, 1, "first id");
  assertStringEqual(a.title, "Buy milk", "title trimmed");
  assert(a.status === TodoStatus.Active, "new todo is active");

  const b = store.add("Learn Haxe");
  assertEqual(b.id, 2, "second id");
  assertEqual(store.list().length, 2, "list length after add");

  store.toggle(1);
  const afterToggle1 = store.list();
  assertEqual(afterToggle1.length, 2, "list length unchanged after toggle");
  const firstAfterToggle1 = afterToggle1[0];
  assert(firstAfterToggle1 != null, "first todo exists");
  assertEqual(firstAfterToggle1.id, 1, "toggle leaves first todo in list");
  assert(firstAfterToggle1.status === TodoStatus.Done, "toggle sets done");

  store.toggle(1);
  const afterToggle2 = store.list();
  const firstAfterToggle2 = afterToggle2[0];
  assert(firstAfterToggle2 != null, "first todo exists (toggle 2)");
  assert(firstAfterToggle2.status === TodoStatus.Active, "toggle sets active");

  assert(store.remove(2), "remove returns true");
  assertEqual(store.list().length, 1, "list length after remove");
  assert(!store.has(2), "removed todo not found");

  let threw = false;
  try {
    store.add("   ");
  } catch {
    threw = true;
  }
  assert(threw, "add(empty) throws");

  console.log("ROUNDTRIP_OK");
}
