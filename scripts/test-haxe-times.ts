import { deepStrictEqual, strictEqual } from "node:assert";
import { parseHaxeTimes } from "./haxe-times.js";

const sample = `warning before the timing table
name                   | time(s) |   % |  p% |      # | info
-------------------------------------------------------
macro                  |   0.419 |  96 |  96 |   8368 |
  jsGenerator          |   0.350 |  80 |  84 |   1768 |
    modules            |   0.111 |  25 |  32 |      1 | genes.validate
    implementation     |   0.073 |  17 |  21 |   1090 | genes.emit
      emitModule       |   0.056 |  13 |  77 |    917 |
typing                 |   0.005 |   1 |   1 |  27994 |
-------------------------------------------------------
total                  |   0.438 | 100 | 100 | 123788 |
`;

const rows = parseHaxeTimes(sample);
strictEqual(rows.length, 7);
deepStrictEqual(rows.map((row) => row.path), [
  "macro",
  "macro/jsGenerator",
  "macro/jsGenerator/genes.validate.modules",
  "macro/jsGenerator/genes.emit.implementation",
  "macro/jsGenerator/genes.emit.implementation/emitModule",
  "typing",
  "total"
]);
deepStrictEqual(rows[2], {
  name: "modules",
  id: "genes.validate.modules",
  path: "macro/jsGenerator/genes.validate.modules",
  depth: 2,
  reportedSeconds: 0.111,
  percentOfTotal: 25,
  percentOfParent: 32,
  count: 1,
  info: "genes.validate"
});

let rejectedMissingTotal = false;
try {
  parseHaxeTimes("macro | 0.100 | 100 | 100 | 1 |\n");
} catch (error) {
  rejectedMissingTotal = String(error).includes("total row");
}
strictEqual(rejectedMissingTotal, true);

let rejectedOddIndent = false;
try {
  parseHaxeTimes(" macro | 0.100 | 100 | 100 | 1 |\ntotal | 0.100 | 100 | 100 | 1 |\n");
} catch (error) {
  rejectedOddIndent = String(error).includes("indentation");
}
strictEqual(rejectedOddIndent, true);

process.stdout.write("haxe-times:ok\n");
