import makeId from "../lib/id.js";
import { Todo, createTodo, withStatus } from "../domain/Todo.js";

export async function seedTodos(): Promise<ReadonlyArray<Todo>> {
  const out: Todo[] = [];
  out.push(createTodo(makeId("t"), "learn ts2hx"));
  out.push(createTodo(makeId("t"), "ship v1"));
  // Drive async/await support with explicit Promise types.
  return await Promise.resolve(out);
}

export async function completeFirst(todos: ReadonlyArray<Todo>): Promise<Todo[]> {
  try {
    if (todos.length === 0) throw "empty";
    const first = todos[0];
    const done = withStatus(first, "done");
    const rest = todos.slice(1);
    return await Promise.resolve([done].concat(rest));
  } catch (_e) {
    return [];
  }
}
