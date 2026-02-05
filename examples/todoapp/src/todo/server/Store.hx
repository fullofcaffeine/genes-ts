package todo.server;

import js.node.Fs;
import js.node.console.Console;
import todo.shared.Api.UpdateTodoBody;
import todo.shared.Todo;
import todo.shared.TodoId;

private typedef PersistedStore = {
  final todos: Array<Todo>;
}

class Store {
  final todos: Array<Todo> = [];
  final dataPath: Null<String>;
  final console: Console;

  public function new(?dataPath: String) {
    this.dataPath = dataPath;
    // Use the warning-free global binding (see `todo.server.NodeGlobals`).
    this.console = NodeGlobals.console();
    if (dataPath != null)
      load();
  }

  static function nowIso(): String
    return cast js.Syntax.code("new Date().toISOString()");

  public function list(): Array<Todo>
    return todos.copy();

  public function get(id: TodoId): Null<Todo> {
    for (t in todos)
      if (t.id == id)
        return t;
    return null;
  }

  public function create(title: String): Todo {
    final now = nowIso();
    final todo: Todo = {
      id: TodoId.create(),
      title: title,
      completed: false,
      createdAt: now,
      updatedAt: now
    };
    todos.push(todo);
    save();
    return todo;
  }

  public function update(id: TodoId, patch: UpdateTodoBody): Null<Todo> {
    final todo = get(id);
    if (todo == null)
      return null;
    if (patch.title != null)
      todo.title = patch.title;
    if (patch.completed != null)
      todo.completed = patch.completed;
    todo.updatedAt = nowIso();
    save();
    return todo;
  }

  public function remove(id: TodoId): Bool {
    for (i in 0...todos.length) {
      if (todos[i].id == id) {
        todos.splice(i, 1);
        save();
        return true;
      }
    }
    return false;
  }

  function load(): Void {
    if (dataPath == null)
      return;
    try {
      if (!Fs.existsSync(dataPath))
        return;
      final raw = Fs.readFileSync(dataPath, "utf8");
      final parsed: PersistedStore = cast haxe.Json.parse(raw);
      final arr = parsed.todos;
      if (arr == null)
        return;
      for (t in arr)
        todos.push(t);
    } catch (e) {
      console.error("Failed to load data:", e);
    }
  }

  function save(): Void {
    if (dataPath == null)
      return;
    try {
      final payload = {todos: todos};
      Fs.writeFileSync(dataPath, haxe.Json.stringify(payload, null, "  "),
        "utf8");
    } catch (e) {
      console.error("Failed to save data:", e);
    }
  }
}
