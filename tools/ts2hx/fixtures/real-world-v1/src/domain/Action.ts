import { Todo } from "./Todo.js";

export type Action =
  | { type: "add"; title: string }
  | { type: "toggle"; id: string }
  | { type: "hydrate"; todos: ReadonlyArray<Todo> };

