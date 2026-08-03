package todo.shared;

import haxe.extern.EitherType;

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

typedef UpdateTodoTitleBody = {
  final title: String;
  @:ts.optional final ?completed: Bool;
}

typedef UpdateTodoCompletedBody = {
  @:ts.optional final ?title: String;
  final completed: Bool;
}

/**
 * A Todo update must change the title, completion state, or both.
 *
 * The union makes at least one property required for both Haxe and TypeScript
 * callers. `@:ts.optional` removes Haxe's synthetic `null` from the optional
 * sibling property, so TypeScript does not advertise explicit JSON `null`.
 */
typedef UpdateTodoBody = EitherType<UpdateTodoTitleBody,
  UpdateTodoCompletedBody>;

class Api {
  public static inline var TODOS = "/api/todos";

  public static inline function todo(id: TodoId): String
    return '/api/todos/$id';
}
