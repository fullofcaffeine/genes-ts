package ts2hx;

import ts2hx.services.TodoService.seedTodos;
import ts2hx.services.TodoService.completeFirst;
import ts2hx.domain.Todo.isDone;

/**
 * Compiler-internal ordered ESM request carrier.
 * @:keep retains typed anchors through full Haxe DCE; the Genes planner
 * consumes every marker and erases this field from JS, TS, and declarations.
 */
@:keep
@:noCompletion
@:genes.compilerInternal
final __ts2hx_requests = {
  genes.internal.EsmRequestFact.internal(seedTodos);
  genes.internal.EsmRequestFact.internal(isDone);
  true;
};

function run(): js.lib.Promise<Float> {
  return __Ts2hxAsync.run();
}

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
