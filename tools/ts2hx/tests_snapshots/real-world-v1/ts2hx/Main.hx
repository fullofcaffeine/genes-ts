package ts2hx;

import ts2hx.services.TodoService.seedTodos;
import ts2hx.services.TodoService.completeFirst;
import ts2hx.domain.Todo.isDone;

final run = __Ts2hxAsync.run;

function main(): Void {
  run().then(function(n) return trace(("REAL_WORLD_V1_OK:" + n)));
}

private class __Ts2hxAsync {
  public static final run = @:async function(): js.lib.Promise<Float> {
  final seeded = genes.js.Async.await(seedTodos());
  final updated = genes.js.Async.await(completeFirst(seeded));
  var done = 0;
  for (t in updated)   {
    if (isDone(t))     {
      done++;
    }
  }
  return done;
};
}
