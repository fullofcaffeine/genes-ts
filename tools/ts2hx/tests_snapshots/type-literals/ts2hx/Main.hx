package ts2hx;

import ts2hx.Assert.assert;
import ts2hx.Assert.assertEqual;
import ts2hx.Assert.assertStringEqual;
import ts2hx.Model.makeTodo;
import ts2hx.Model.Todo;

function main(): Void {
  final t: Todo = makeTodo(1, "x");
  assertEqual(t.id, 1, "id");
  assertStringEqual(t.title, "x", "title");
  assert((t.done == null), "optional field omitted");
  trace("TYPE_LITERALS_OK");
}
