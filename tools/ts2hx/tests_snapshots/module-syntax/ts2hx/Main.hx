package ts2hx;

import ts2hx.Assert.assertEqual;
import ts2hx.Assert.assertStringEqual;
import ts2hx.lib.DefaultThing.__default as greet;
import ts2hx.lib.Reexport.PI;
import ts2hx.lib.Reexport.sum;
import ts2hx.lib.Reexport.greet as greet2;
import ts2hx.lib.Reexport.defaultVersion;

function main(): Void {
  assertEqual(ts2hx.lib.Math.add(1, 2), 3, "namespace import (M.add)");
  assertEqual(PI, 3.14, "export * reexport (PI)");
  assertEqual(sum(2, 3), 5, "re-export named (sum)");
  assertEqual(defaultVersion, 1, "re-export value (defaultVersion)");
  assertStringEqual(greet("x"), "hi x", "default import (greet)");
  assertStringEqual(greet2("y"), "hi y", "re-export default as named (greet2)");
  trace("MODULE_OK");
}
