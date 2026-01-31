package ts2hx;

typedef Todo = { var id: Float; var title: String; @:optional var done: Bool; };

function makeTodo(id: Float, title: String): Todo {
  return { id: id, title: title };
}
