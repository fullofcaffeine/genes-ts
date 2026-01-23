package todo.shared;

typedef TodoListResponse = {
  final todos: Array<Todo>;
}

typedef TodoResponse = {
  final todo: Todo;
}

typedef ErrorResponse = {
  final error: String;
}

typedef CreateTodoBody = {
  final title: String;
}

typedef UpdateTodoBody = {
  final ?title: String;
  final ?completed: Bool;
}

class Api {
  public static inline var TODOS = "/api/todos";

  public static inline function todo(id: TodoId): String
    return '/api/todos/$id';
}

