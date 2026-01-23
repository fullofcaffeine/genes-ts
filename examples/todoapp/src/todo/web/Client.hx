package todo.web;

import js.lib.Promise;
import todo.shared.Api;
import todo.shared.Api.CreateTodoBody;
import todo.shared.Api.TodoListResponse;
import todo.shared.Api.TodoResponse;
import todo.shared.Api.UpdateTodoBody;
import todo.shared.Todo;
import todo.shared.TodoId;

class Client {
  static function requestJson(method: String, url: String,
      ?body: Dynamic): Promise<Dynamic> {
    final headers: Dynamic = {"Content-Type": "application/json"};
    final opts: Dynamic = {method: method, headers: headers};
    if (body != null)
      opts.body = haxe.Json.stringify(body);

    final p: Promise<Dynamic> = cast js.Syntax.code("fetch({0}, {1})", url, opts);
    return p.then(res -> {
      final ok: Bool = untyped res.ok;
      final status: Int = untyped res.status;
      if (status == 204)
        return Promise.resolve(null);
      final jp: Promise<Dynamic> = cast untyped res.json();
      if (ok)
        return jp;
      return jp.then(err -> Promise.reject(err));
    });
  }

  public static function listTodos(): Promise<Array<Todo>> {
    return requestJson("GET", Api.TODOS).then((data: Dynamic) -> {
      final res: TodoListResponse = cast data;
      return res.todos;
    });
  }

  public static function getTodo(id: TodoId): Promise<Todo> {
    return requestJson("GET", Api.todo(id)).then((data: Dynamic) -> {
      final res: TodoResponse = cast data;
      return res.todo;
    });
  }

  public static function createTodo(title: String): Promise<Todo> {
    final body: CreateTodoBody = {title: title};
    return requestJson("POST", Api.TODOS, body).then((data: Dynamic) -> {
      final res: TodoResponse = cast data;
      return res.todo;
    });
  }

  public static function updateTodo(id: TodoId, patch: UpdateTodoBody): Promise<Todo> {
    return requestJson("PATCH", Api.todo(id), patch).then((data: Dynamic) -> {
      final res: TodoResponse = cast data;
      return res.todo;
    });
  }

  public static function deleteTodo(id: TodoId): Promise<Bool> {
    return requestJson("DELETE", Api.todo(id)).then((_data: Dynamic) -> true);
  }
}

