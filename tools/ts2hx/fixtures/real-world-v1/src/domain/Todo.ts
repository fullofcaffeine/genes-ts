export type TodoStatus = "active" | "done";

export type Todo = {
  id: string;
  title: string;
  status: TodoStatus;
};

export function createTodo(id: string, title: string): Todo {
  return { id, title, status: "active" };
}

export function withStatus(todo: Todo, status: TodoStatus): Todo {
  return { ...todo, status };
}

export function isDone(todo: Todo): boolean {
  return todo.status === "done";
}

export function summary(todo: Todo): string {
  return todo.id + ":" + todo.title + ":" + todo.status;
}

