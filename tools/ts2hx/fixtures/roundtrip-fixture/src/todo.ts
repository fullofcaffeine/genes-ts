export enum TodoStatus {
  Active = "active",
  Done = "done"
}

export type Todo = {
  id: number;
  title: string;
  status: TodoStatus;
};

export class TodoStore {
  private nextId: number;
  private todos: Array<Todo>;

  constructor() {
    this.nextId = 1;
    this.todos = [];
  }

  public add(title: string): Todo {
    const trimmed = title.trim();
    if (trimmed.length === 0) throw new Error("title required");

    const todo: Todo = {
      id: this.nextId,
      title: trimmed,
      status: TodoStatus.Active
    };
    this.nextId++;
    this.todos.push(todo);
    return todo;
  }

  public list(): Array<Todo> {
    // Return a copy to keep callers from mutating internal state.
    return this.todos.slice();
  }

  public get(id: number): Todo | null {
    const found = this.todos.find((t) => t.id === id);
    return found ?? null;
  }

  public toggle(id: number): Todo {
    const todo = this.get(id);
    if (!todo) throw new Error("not found");
    todo.status = todo.status === TodoStatus.Active ? TodoStatus.Done : TodoStatus.Active;
    return todo;
  }

  public remove(id: number): boolean {
    const idx = this.todos.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    this.todos.splice(idx, 1);
    return true;
  }
}
