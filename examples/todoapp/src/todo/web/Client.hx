package todo.web;

import js.lib.Promise;
import todo.extern.Fetch.Fetch;
import todo.extern.Fetch.FetchHeaders;
import todo.extern.Fetch.FetchRequestInit;
import todo.extern.Fetch.FetchResponse;
import todo.shared.Api;
import todo.shared.Api.CreateTodoBody;
import todo.shared.Api.ErrorResponse;
import todo.shared.Api.TodoListResponse;
import todo.shared.Api.TodoResponse;
import todo.shared.Todo;
import todo.shared.TodoId;

class Client {
  /** Decode a response after a route-specific method has issued the request. */
  static function decodeResponse<T>(res: FetchResponse): Promise<T> {
    if (res.status == 204)
      return Promise.reject({error: "no_content"});

    if (res.ok)
      return res.json();

    final jp: Promise<ErrorResponse> = res.json();
    return jp.then(err -> Promise.reject(err));
  }

  public static function listTodos(): Promise<Array<Todo>> {
    final headers: FetchHeaders = {};
    final opts: FetchRequestInit = {method: "GET", headers: headers};
    final p: Promise<TodoListResponse> = Fetch.fetch(Api.TODOS, opts)
      .then(res -> decodeResponse(res));
    return p.then(res -> {
      return res.todos;
    });
  }

  public static function getTodo(id: TodoId): Promise<Todo> {
    final headers: FetchHeaders = {};
    final opts: FetchRequestInit = {method: "GET", headers: headers};
    final p: Promise<TodoResponse> = Fetch.fetch(Api.todo(id), opts)
      .then(res -> decodeResponse(res));
    return p.then(res -> {
      return res.todo;
    });
  }

  public static function createTodo(title: String): Promise<Todo> {
    final body: CreateTodoBody = {title: title};
    final headers: FetchHeaders = {};
    headers["Content-Type"] = "application/json";
    final opts: FetchRequestInit = {
      method: "POST",
      headers: headers,
      body: haxe.Json.stringify(body)
    };
    final p: Promise<TodoResponse> = Fetch.fetch(Api.TODOS, opts)
      .then(res -> decodeResponse(res));
    return p.then(res -> {
      return res.todo;
    });
  }

  public static function updateTodoTitle(id: TodoId,
      title: String): Promise<Todo> {
    final headers: FetchHeaders = {};
    headers["Content-Type"] = "application/json";
    final opts: FetchRequestInit = {
      method: "PATCH",
      headers: headers,
      body: haxe.Json.stringify({title: title})
    };
    final p: Promise<TodoResponse> = Fetch.fetch(Api.todo(id), opts)
      .then(res -> decodeResponse(res));
    return p.then(res -> {
      return res.todo;
    });
  }

  public static function updateTodoCompleted(id: TodoId,
      completed: Bool): Promise<Todo> {
    final headers: FetchHeaders = {};
    headers["Content-Type"] = "application/json";
    final opts: FetchRequestInit = {
      method: "PATCH",
      headers: headers,
      body: haxe.Json.stringify({completed: completed})
    };
    final p: Promise<TodoResponse> = Fetch.fetch(Api.todo(id), opts)
      .then(res -> decodeResponse(res));
    return p.then(res -> {
      return res.todo;
    });
  }

  public static function deleteTodo(id: TodoId): Promise<Bool> {
    // This endpoint returns 204 No Content on success.
    final headers: FetchHeaders = {};
    return Fetch.fetch(Api.todo(id), {method: "DELETE", headers: headers})
      .then(res -> {
        if (res.status == 204)
          return Promise.resolve(true);
        final jp: Promise<ErrorResponse> = res.json();
        return jp.then(err -> (Promise.reject(err) : Promise<Bool>));
      });
  }
}
