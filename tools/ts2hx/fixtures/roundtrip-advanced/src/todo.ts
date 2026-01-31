import { clamp } from "./math.js";

export enum TodoStatus {
  Active = "active",
  Done = "done"
}

export class Todo {
  public id: number;
  public title: string;
  public status: TodoStatus;
  public priority: number;

  constructor(id: number, title: string, status: TodoStatus, priority: number) {
    this.id = id;
    this.title = title;
    this.status = status;
    this.priority = priority;
  }
}

export interface CreateTodoOptions {
  priority?: number;
}

export class TodoStore {
  private nextId: number;
  private todos: Todo[];

  constructor() {
    this.nextId = 1;
    this.todos = [];
  }

  public add(title: string, opts: CreateTodoOptions): Todo {
    const trimmed = title.trim();
    if (trimmed.length === 0) throw new Error("title required");

    const pr = clamp(opts.priority ?? 1, 1, 5);
    const todo = new Todo(this.nextId, trimmed, TodoStatus.Active, pr);
    this.nextId = this.nextId + 1;
    this.todos.push(todo);
    return todo;
  }

  public list(): Todo[] {
    return this.todos.slice();
  }

  public toggle(id: number): void {
    for (let i = 0; i < this.todos.length; i = i + 1) {
      const t = this.todos[i];
      if (t.id === id) {
        t.status = t.status === TodoStatus.Active ? TodoStatus.Done : TodoStatus.Active;
        return;
      }
    }
    throw new Error(`not found: ${id}`);
  }

  public titlesByStatus(status: TodoStatus): string[] {
    return this.todos.filter((t) => t.status === status).map((t) => t.title);
  }
}

