export enum TodoStatus {
  Active = "active",
  Done = "done"
}

export class Todo {
  public id: number;
  public title: string;
  public status: TodoStatus;

  constructor(id: number, title: string, status: TodoStatus) {
    this.id = id;
    this.title = title;
    this.status = status;
  }
}

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

    const todo = new Todo(this.nextId, trimmed, TodoStatus.Active);
    this.nextId = this.nextId + 1;
    this.todos.push(todo);
    return todo;
  }

  public list(): Array<Todo> {
    // Return a copy to keep callers from mutating internal state.
    return this.todos.slice();
  }

  public has(id: number): boolean {
    for (let i = 0; i < this.todos.length; i = i + 1) {
      const t = this.todos[i];
      if (t.id === id) return true;
    }
    return false;
  }

  public toggle(id: number): Todo {
    for (let i = 0; i < this.todos.length; i = i + 1) {
      const t = this.todos[i];
      if (t.id === id) {
        t.status = t.status === TodoStatus.Active ? TodoStatus.Done : TodoStatus.Active;
        return t;
      }
    }
    throw new Error("not found");
  }

  public remove(id: number): boolean {
    for (let i = 0; i < this.todos.length; i = i + 1) {
      const t = this.todos[i];
      if (t.id === id) {
        this.todos.splice(i, 1);
        return true;
      }
    }
    return false;
  }
}
