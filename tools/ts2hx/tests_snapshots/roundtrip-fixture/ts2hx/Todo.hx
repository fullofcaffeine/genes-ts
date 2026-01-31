package ts2hx;

enum abstract TodoStatus(String) from String to String {
  var Active = "active";
  var Done = "done";
}

class Todo {
  public var id: Float;
  public var title: String;
  public var status: TodoStatus;
  public function new(id: Float, title: String, status: TodoStatus) {
    this.id = id;
    this.title = title;
    this.status = status;
  }
}

class TodoStore {
  private var nextId: Float;
  private var todos: Array<Todo>;
  public function new() {
    this.nextId = 1;
    this.todos = [];
  }
  public function add(title: String): Todo {
    var trimmed = StringTools.trim(title);
    if ((trimmed.length == 0))   {
      throw new js.lib.Error("title required");
    }
    var todo = new Todo(this.nextId, trimmed, TodoStatus.Active);
    this.nextId = (this.nextId + 1);
    this.todos.push(todo);
    return todo;
  }
  public function list(): Array<Todo> {
    return this.todos.slice(0);
  }
  public function has(id: Float): Bool {
    {
      var i = 0;
      while ((i < this.todos.length)) {
        var t = this.todos[i];
        if ((t.id == id))       {
          return true;
        }
        i = (i + 1);
      }
    }
    return false;
  }
  public function toggle(id: Float): Todo {
    {
      var i = 0;
      while ((i < this.todos.length)) {
        var t = this.todos[i];
        if ((t.id == id))       {
          t.status = ((t.status == TodoStatus.Active) ? TodoStatus.Done : TodoStatus.Active);
          return t;
        }
        i = (i + 1);
      }
    }
    throw new js.lib.Error("not found");
  }
  public function remove(id: Float): Bool {
    {
      var i = 0;
      while ((i < this.todos.length)) {
        var t = this.todos[i];
        if ((t.id == id))       {
          this.todos.splice(i, 1);
          return true;
        }
        i = (i + 1);
      }
    }
    return false;
  }
}
