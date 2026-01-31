import { assert, assertEqual, assertStringEqual } from "./assert.js";
import { makeTodo, type Todo } from "./model.js";

export function main(): void {
  const t: Todo = makeTodo(1, "x");
  assertEqual(t.id, 1, "id");
  assertStringEqual(t.title, "x", "title");
  assert(t.done == null, "optional field omitted");

  console.log("TYPE_LITERALS_OK");
}

