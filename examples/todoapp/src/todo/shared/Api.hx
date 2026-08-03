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
 * The wire-format union makes at least one property required. `@:ts.optional`
 * removes Haxe's synthetic `null` from the optional sibling in generated
 * TypeScript. Haxe application code uses Client's concrete update helpers
 * under package-scoped null safety rather than accepting this transport record
 * as a public call argument.
 */
typedef UpdateTodoBody = EitherType<UpdateTodoTitleBody,
  UpdateTodoCompletedBody>;

class Api {
  public static inline var TODOS = "/api/todos";

  public static inline function todo(id: TodoId): String
    return '/api/todos/$id';
}
