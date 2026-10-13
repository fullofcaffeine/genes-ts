import { deepStrictEqual, rejects, strictEqual } from "node:assert";
import { runHxxNegativeBatch } from "./hxx-negative-batch.js";

function latch(): { readonly promise: Promise<void>; readonly release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

// A real overlap must occur, but a third case cannot start until one finishes.
const firstPair = latch();
const releasePair = latch();
const started: number[] = [];
const finished: number[] = [];
let active = 0;
let peak = 0;
const parallel = runHxxNegativeBatch([0, 1, 2, 3], async (value) => {
  started.push(value);
  peak = Math.max(peak, ++active);
  if (started.length === 2) firstPair.release();
  if (value < 2) await releasePair.promise;
  active--;
  finished.push(value);
}, "2");
await firstPair.promise;
deepStrictEqual(started, [0, 1]);
releasePair.release();
await parallel;
strictEqual(peak, 2);
deepStrictEqual(finished.sort(), [0, 1, 2, 3]);

const serial: number[] = [];
await runHxxNegativeBatch([0, 1, 2], async (value) => { serial.push(value); }, "1");
deepStrictEqual(serial, [0, 1, 2]);

// Failure must drain the other admitted observer without starting queued work.
const failed = latch();
const releaseOther = latch();
const attempted: number[] = [];
let drained = false;
let completed = false;
const rejection = runHxxNegativeBatch([0, 1, 2], async (value) => {
  attempted.push(value);
  if (value === 0) {
    failed.release();
    throw new Error("independent expected failure");
  }
  await releaseOther.promise;
  drained = true;
}, "2").finally(() => { completed = true; });
const checkedRejection = rejects(rejection, AggregateError);
await failed.promise;
await Promise.resolve();
strictEqual(completed, false);
releaseOther.release();
await checkedRejection;
strictEqual(drained, true);
deepStrictEqual(attempted, [0, 1]);

for (const workers of ["0", "3", "", "1.5", "two"]) {
  await rejects(runHxxNegativeBatch([0], async () => {
    throw new Error("invalid setting admitted work");
  }, workers), /must be 1 or 2/);
}
console.log("HXX negative batch: overlap, bound, serial order, failure drain and admission checks passed");
