package ts2hx;

import ts2hx.Assert.assertEqual;
import ts2hx.Assert.assertStringEqual;
import ts2hx.lib.DefaultThing.__default as greet;
import ts2hx.lib.Reexport.PI;
import ts2hx.lib.Reexport.sum;
import ts2hx.lib.Reexport.greet as greet2;
import ts2hx.lib.Reexport.defaultVersion;

/**
 * Compiler-internal ordered ESM request carrier.
 * @:keep retains typed anchors through full Haxe DCE; the Genes planner
 * consumes every marker and erases this field from JS, TS, and declarations.
 */
@:keep
@:noCompletion
@:genes.compilerInternal
final __ts2hx_requests = {
  genes.internal.EsmRequestFact.internal(assertEqual);
  genes.internal.EsmRequestFact.internal(greet);
  genes.internal.EsmRequestFact.internal(ts2hx.lib.Math.__ts2hx_init_a29a1b1f86);
  genes.internal.EsmRequestFact.internal(PI);
  true;
};

function main(): Void {
  assertEqual(ts2hx.lib.Math.add(1, 2), 3, "namespace import (M.add)");
  assertEqual(PI, 3.14, "export * reexport (PI)");
  assertEqual(sum(2, 3), 5, "re-export named (sum)");
  assertEqual(defaultVersion, 1, "re-export value (defaultVersion)");
  assertStringEqual(greet("x"), "hi x", "default import (greet)");
  assertStringEqual(greet2("y"), "hi y", "re-export default as named (greet2)");
  trace("MODULE_OK");
}
