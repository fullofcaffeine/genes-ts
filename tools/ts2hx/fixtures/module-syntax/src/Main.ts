import { assertEqual, assertStringEqual } from "./assert.js";

import greet from "./lib/defaultThing.js";
import * as M from "./lib/math.js";

import { PI, sum, greet as greet2, defaultVersion } from "./lib/reexport.js";

export function main(): void {
  assertEqual(M.add(1, 2), 3, "namespace import (M.add)");
  assertEqual(PI, 3.14, "export * reexport (PI)");
  assertEqual(sum(2, 3), 5, "re-export named (sum)");
  assertEqual(defaultVersion, 1, "re-export value (defaultVersion)");

  assertStringEqual(greet("x"), "hi x", "default import (greet)");
  assertStringEqual(greet2("y"), "hi y", "re-export default as named (greet2)");

  console.log("MODULE_OK");
}

