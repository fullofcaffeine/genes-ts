package todo.web;

import js.lib.Promise;
import todo.extern.Fetch.Fetch;
import todo.extern.Fetch.FetchHeaders;
import todo.extern.Fetch.FetchRequestInit;
import todo.shared.Api;
import todo.shared.Api.CreateTodoBody;
import todo.shared.Api.ErrorResponse;
import todo.shared.Api.TodoListResponse;
import todo.shared.Api.TodoResponse;
import todo.shared.Api.UpdateTodoBody;
import todo.shared.Todo;
import todo.shared.TodoId;

class Client {
  static function requestJson<T>(method: String, url: String, ?body: {}): Promise<T> {
    final headers: FetchHeaders = {};
    headers["Content-Type"] = "application/json";

    final opts: FetchRequestInit = {method: method, headers: headers};
    if (body != null)
      opts.body = haxe.Json.stringify(body);

    return Fetch.fetch(url, opts).then(res -> {
      if (res.status == 204)
        return Promise.reject({error: "no_content"});

      if (res.ok)
        return res.json();

      final jp: Promise<ErrorResponse> = res.json();
      return jp.then(err -> Promise.reject(err));
    });
  }

  public static function listTodos(): Promise<Array<Todo>> {
    final p: Promise<TodoListResponse> = requestJson("GET", Api.TODOS);
    return p.then(res -> {
      return res.todos;
    });
  }

  public static function getTodo(id: TodoId): Promise<Todo> {
    final p: Promise<TodoResponse> = requestJson("GET", Api.todo(id));
    return p.then(res -> {
      return res.todo;
    });
  }

  public static function createTodo(title: String): Promise<Todo> {
    final body: CreateTodoBody = {title: title};
    final p: Promise<TodoResponse> = requestJson("POST", Api.TODOS, body);
    return p.then(res -> {
      return res.todo;
    });
  }

  public static function updateTodo(id: TodoId, patch: UpdateTodoBody): Promise<Todo> {
    final p: Promise<TodoResponse> = requestJson("PATCH", Api.todo(id), patch);
    return p.then(res -> {
      return res.todo;
    });
  }

  public static function deleteTodo(id: TodoId): Promise<Bool> {
    // This endpoint returns 204 No Content on success.
    final headers: FetchHeaders = {};
    return Fetch.fetch(Api.todo(id), {method: "DELETE", headers: headers}).then(res -> {
      if (res.status == 204)
        return Promise.resolve(true);
      final jp: Promise<ErrorResponse> = res.json();
      return jp.then(err -> (Promise.reject(err) : Promise<Bool>));
    });
  }
}
