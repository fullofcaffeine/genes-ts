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
  assert.throws(
    () =>
      new SerializedDirtyLoop<string>({
        debounceMs: -1,
        merge: (left) => left,
        run: async () => {},
        onError: () => {},
      }),
    /non-negative integer/u,
  );

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

  const cancelled: string[] = [];
  const cancelledLoop = new SerializedDirtyLoop<string>({
    debounceMs: 1_000,
    merge: (left, right) => `${left}+${right}`,
    run: async (cause) => {
      cancelled.push(cause);
    },
    onError: () => {},
  });
  cancelledLoop.request("pending");
  await cancelledLoop.close();
  assert.deepEqual(cancelled, []);
  await cancelledLoop.waitForIdle();

  const nullableRuns: Array<string | null> = [];
  const nullableLoop = new SerializedDirtyLoop<string | null>({
    debounceMs: 0,
    merge: (_left, right) => right,
    run: async (cause) => {
      nullableRuns.push(cause);
    },
    onError: () => {},
  });
  nullableLoop.request(null);
  await nullableLoop.waitForIdle();
  assert.deepEqual(nullableRuns, [null]);
  await nullableLoop.close();

  // The first run after an idle period waits only startDelayMs; a request
  // during a run waits the quiet time (debounceMs) before its follow-up.
  assert.throws(
    () =>
      new SerializedDirtyLoop<string>({
        debounceMs: 0,
        startDelayMs: -1,
        merge: (_left, right) => right,
        run: async () => {},
        onError: () => {},
      }),
    /startDelayMs must be a non-negative integer/u,
  );
  const startTimes: number[] = [];
  let releaseFirst!: () => void;
  const firstRunning = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstStarted!: () => void;
  const firstStartedPromise = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const delayLoop = new SerializedDirtyLoop<string>({
    debounceMs: 600,
    startDelayMs: 5,
    merge: (_left, right) => right,
    run: async (cause) => {
      startTimes.push(performance.now());
      if (cause === "first") {
        firstStarted();
        await firstRunning;
      }
    },
    onError: () => {},
  });
  const requestedAt = performance.now();
  delayLoop.request("first");
  await firstStartedPromise;
  assert.ok(
    startTimes[0]! - requestedAt < 300,
    `the first run must start after the start delay, not the quiet time (${startTimes[0]! - requestedAt} ms)`,
  );
  delayLoop.request("follow-up");
  const followUpRequestedAt = performance.now();
  releaseFirst();
  await delayLoop.waitForIdle();
  assert.equal(startTimes.length, 2);
  assert.ok(
    startTimes[1]! - followUpRequestedAt >= 550,
    `a follow-up run must wait the quiet time (${startTimes[1]! - followUpRequestedAt} ms)`,
  );
  await delayLoop.close();

  // `followUpDelayMs` chooses the quiet time of a follow-up by its pending
  // cause: a cheap first step ("preview") starts at once, another cause
  // keeps `debounceMs`.
  const hookTimes: Array<{ readonly cause: string; readonly at: number }> = [];
  let releaseHookFirst!: () => void;
  const hookFirstRunning = new Promise<void>((resolve) => {
    releaseHookFirst = resolve;
  });
  let hookFirstStarted!: () => void;
  const hookFirstStartedPromise = new Promise<void>((resolve) => {
    hookFirstStarted = resolve;
  });
  const hookLoop = new SerializedDirtyLoop<string>({
    debounceMs: 600,
    startDelayMs: 5,
    followUpDelayMs: (cause) => (cause === "preview" ? 5 : 600),
    merge: (_left, right) => right,
    run: async (cause) => {
      hookTimes.push({ cause, at: performance.now() });
      if (cause === "first") {
        hookFirstStarted();
        await hookFirstRunning;
      }
    },
    onError: () => {},
  });
  hookLoop.request("first");
  await hookFirstStartedPromise;
  hookLoop.request("preview");
  const previewRequestedAt = performance.now();
  releaseHookFirst();
  await hookLoop.waitForIdle();
  assert.deepEqual(hookTimes.map((entry) => entry.cause), ["first", "preview"]);
  assert.ok(
    hookTimes[1]!.at - previewRequestedAt < 300,
    `a follow-up whose cause asks for a short delay must not wait the quiet time (${hookTimes[1]!.at - previewRequestedAt} ms)`,
  );
  await hookLoop.close();

  await loop.close();
  console.log("genes tooling serialized dirty loop: ok");
}

await main();
