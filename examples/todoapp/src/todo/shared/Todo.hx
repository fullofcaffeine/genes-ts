package todo.shared;

typedef Todo = {
  final id: TodoId;
  var title: String;
  var completed: Bool;
  final createdAt: String;
  var updatedAt: String;
}

