package ts2hx.services;

import ts2hx.lib.Id.__default as makeId;
import ts2hx.domain.Todo;
import ts2hx.domain.Todo.createTodo;
import ts2hx.domain.Todo.withStatus;

function seedTodos(): js.lib.Promise<Array<Todo>> {
  return __Ts2hxAsync.seedTodos();
}

function completeFirst(todos: Array<Todo>): js.lib.Promise<Array<Todo>> {
  return __Ts2hxAsync.completeFirst(todos);
}

private class __Ts2hxAsync {
  public static final seedTodos = @:async function(): js.lib.Promise<Array<Todo>> {
  final out: Array<Todo> = [];
  out.push(createTodo(makeId("t"), "learn ts2hx"));
  out.push(createTodo(makeId("t"), "ship v1"));
  return genes.js.Async.await(js.lib.Promise.resolve(out));
};
  public static final completeFirst = @:async function(todos: Array<Todo>): js.lib.Promise<Array<Todo>> {
  try {
    if (genes.js.Equality.strict(todos.length, 0))     {
      throw "empty";
    }
    final first = todos[0];
    final done = withStatus(first, "done");
    final rest = todos.slice(1);
    return genes.js.Async.await(js.lib.Promise.resolve([done].concat(rest)));
  } catch (_e: Any) {
    return [];
  }
};
}
