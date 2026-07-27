import assert from "node:assert/strict";

import { SerializedDirtyLoop } from "./loop/index.js";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => {
      assert.notEqual(resolvePromise, null);
      resolvePromise!();
    },
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail("condition did not become true before the test deadline");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
}

async function main(): Promise<void> {
  const gates = [deferred(), deferred()];
  const runs: string[][] = [];
  const errors: string[] = [];
  const loop = new SerializedDirtyLoop<readonly string[]>({
    debounceMs: 0,
    merge: (left, right) =>
      Object.freeze([...new Set([...left, ...right])].sort()),
    run: async (cause) => {
      const index = runs.length;
      runs.push([...cause]);
      await gates[index]!.promise;
    },
    onError: (error) => errors.push(error.message),
  });

  loop.request(["a"]);
  loop.request(["b"]);
  await waitUntil(() => runs.length === 1);
  assert.deepEqual(runs, [["a", "b"]]);
  assert.equal(loop.state, "running");

  loop.request(["c"]);
  loop.request(["b", "d"]);
  gates[0]!.resolve();
  await waitUntil(() => runs.length === 2);
  assert.deepEqual(runs, [
    ["a", "b"],
    ["b", "c", "d"],
  ]);

  gates[1]!.resolve();
  await loop.waitForIdle();
  assert.equal(loop.state, "idle");
  assert.deepEqual(errors, []);

  const failed: string[] = [];
  const recovered: string[] = [];
  const failureLoop = new SerializedDirtyLoop<string>({
    debounceMs: 0,
    merge: (left, right) => `${left}+${right}`,
    run: async (cause) => {
      if (cause === "bad") {
        throw new Error("expected failure");
      }
      recovered.push(cause);
    },
    onError: (error) => failed.push(error.message),
  });
  failureLoop.request("bad");
  await failureLoop.waitForIdle();
  failureLoop.request("good");
  await failureLoop.waitForIdle();
  assert.deepEqual(failed, ["expected failure"]);
  assert.deepEqual(recovered, ["good"]);

  await failureLoop.close();
  failureLoop.request("ignored");
  await failureLoop.waitForIdle();
  assert.equal(failureLoop.state, "closed");
  assert.deepEqual(recovered, ["good"]);

  await loop.close();
  console.log("genes tooling serialized dirty loop: ok");
}

await main();
