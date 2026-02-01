package ts2hx.domain;

enum abstract TodoStatus(String) from String to String {
  var Active = "active";
  var Done = "done";
}

typedef Todo = { var id: String; var title: String; var status: TodoStatus; };

function createTodo(id: String, title: String): Todo {
  return { id: id, title: title, status: "active" };
}

function withStatus(todo: Todo, status: TodoStatus): Todo {
  return js.lib.Object.assign(cast {}, todo, { status: status });
}

function isDone(todo: Todo): Bool {
  return (todo.status == "done");
}

function summary(todo: Todo): String {
  return ((((todo.id + ":") + todo.title) + ":") + todo.status);
}
