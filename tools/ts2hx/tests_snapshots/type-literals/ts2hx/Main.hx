package ts2hx;

import ts2hx.Assert.assert;
import ts2hx.Assert.assertEqual;
import ts2hx.Assert.assertStringEqual;
import ts2hx.Model.makeTodo;
import ts2hx.Model.Todo;

/**
 * Compiler-internal ordered ESM request carrier.
 * @:keep retains typed anchors through full Haxe DCE; the Genes planner
 * consumes every marker and erases this field from JS, TS, and declarations.
 */
@:keep
@:noCompletion
@:genes.compilerInternal
final __ts2hx_requests = {
  genes.internal.EsmRequestFact.internal(assert);
  genes.internal.EsmRequestFact.internal(makeTodo);
  true;
};

function main(): Void {
  final t: Todo = makeTodo(1, "x");
  assertEqual(t.id, 1, "id");
  assertStringEqual(t.title, "x", "title");
  assert((t.done == null), "optional field omitted");
  trace("TYPE_LITERALS_OK");
}
