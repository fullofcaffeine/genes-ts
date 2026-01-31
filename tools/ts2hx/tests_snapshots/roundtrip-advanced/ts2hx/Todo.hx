package ts2hx;

import ts2hx.Math.clamp;

enum abstract TodoStatus(String) from String to String {
  var Active = "active";
  var Done = "done";
}

class Todo {
  public var id: Float;
  public var title: String;
  public var status: TodoStatus;
  public var priority: Float;
  public function new(id: Float, title: String, status: TodoStatus, priority: Float) {
    this.id = id;
    this.title = title;
    this.status = status;
    this.priority = priority;
  }
}

typedef CreateTodoOptions = {
  @:optional var priority: Float;
}

class TodoStore {
  private var nextId: Float;
  private var todos: Array<Todo>;
  public function new() {
    this.nextId = 1;
    this.todos = [];
  }
  public function add(title: String, opts: CreateTodoOptions): Todo {
    var trimmed = StringTools.trim(title);
    if ((trimmed.length == 0))   {
      throw new js.lib.Error("title required");
    }
    var pr = clamp((opts.priority ?? 1), 1, 5);
    var todo = new Todo(this.nextId, trimmed, TodoStatus.Active, pr);
    this.nextId = (this.nextId + 1);
    this.todos.push(todo);
    return todo;
  }
  public function list(): Array<Todo> {
    return this.todos.slice(0);
  }
  public function toggle(id: Float): Void {
    {
      var i = 0;
      while ((i < this.todos.length)) {
        var t = this.todos[i];
        if ((t.id == id))       {
          t.status = ((t.status == TodoStatus.Active) ? TodoStatus.Done : TodoStatus.Active);
          return;
        }
        i = (i + 1);
      }
    }
    throw new js.lib.Error(("not found: " + id));
  }
  public function titlesByStatus(status: TodoStatus): Array<String> {
    return this.todos.filter(function(t) return (t.status == status)).map(function(t) return t.title);
  }
}
