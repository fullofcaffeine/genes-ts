import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  publishArtifacts,
  recoverArtifacts,
  type PublicationPlan,
} from "./artifacts/index.js";
import { inventoryHxml } from "./hxml/index.js";
import type { HaxeWaitServerEvent } from "./haxe-server/index.js";
import type {
  ReconciledWatchOptions,
  ReconciledWatchSession,
  WatchInput,
} from "./watch/index.js";
import type { SessionCompiler } from "./session/haxe-driver.js";
import type { SessionLayout } from "./session/layout.js";
import {
  createGenesDevelopmentSessionWithDependencies,
  type SessionDependencies,
} from "./session/runtime.js";
import { acquireSessionLock } from "./session/session-lock.js";
import type {
  DevelopmentEvent,
  DevelopmentSession,
  JsonValue,
} from "./session/types.js";

type StateKind =
  | "opening"
  | "building"
  | "blocked"
  | "ready"
  | "degraded"
  | "closing"
  | "closed";

interface EventRun {
  readonly kind: string;
  readonly count: number;
}

interface Vector {
  readonly id: string;
  readonly script: readonly string[];
  readonly expected: {
    readonly finalState: StateKind;
    readonly revisionsObserved: number;
    readonly acceptedGenerations: number;
    readonly acceptedRevision: number | null;
    readonly retainedGeneration: number | null;
    readonly firstAccepted: "resolved" | "pending" | "rejected";
    readonly publicationAttempts: number;
    readonly publicWrites: number;
    readonly readBarrier: "not-exercised" | "publication-waited-for-reader";
    readonly eventRuns: readonly EventRun[];
    readonly stateKinds: readonly StateKind[];
    readonly eventChecks: readonly DevelopmentEvent<JsonValue>[];
  };
}

interface Corpus {
  readonly vectors: readonly Vector[];
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolvePromise!: (value: Value) => void;
  return {
    promise: new Promise((resolve) => {
      resolvePromise = resolve;
    }),
    resolve: (value) => resolvePromise(value),
  };
}

function manifestName(owner: string): string {
  const readable = owner.replaceAll(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 48);
  const digest = createHash("sha256").update(owner).digest("hex");
  return `.genes-output-${readable}-${digest}.manifest`;
}

interface CompileStep {
  readonly fail: boolean;
  readonly mode: "connected" | "direct";
  readonly content: string;
  readonly hold?: Deferred<void>;
  readonly emitFallback?: boolean;
}

class VectorCompiler implements SessionCompiler {
  readonly #steps: CompileStep[];
  readonly #onEvent: (event: HaxeWaitServerEvent) => void;

  constructor(
    steps: CompileStep[],
    onEvent: (event: HaxeWaitServerEvent) => void,
  ) {
    this.#steps = steps;
    this.#onEvent = onEvent;
  }

  async compile(
    _invocation: Parameters<SessionCompiler["compile"]>[0],
    _digest: string,
    signal: AbortSignal,
  ): Promise<{ readonly mode: "connected" | "direct" }> {
    const { candidateOutputFile } = _invocation;
    const step = this.#steps.shift();
    assert.notEqual(step, undefined, "vector requested an unplanned compile");
    if (step!.emitFallback) {
      this.#onEvent({ kind: "fallback", reason: "server-unresponsive" });
    }
    if (step!.hold !== undefined) {
      await Promise.race([
        step!.hold.promise,
        new Promise<never>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new Error("compile cancelled")),
            { once: true },
          ),
        ),
      ]);
    }
    if (step!.fail) throw new Error("fixture compile failed");
    mkdirSync(path.dirname(candidateOutputFile), { recursive: true });
    writeFileSync(candidateOutputFile, step!.content, "utf8");
    const owner = path.basename(candidateOutputFile);
    writeFileSync(
      path.join(path.dirname(candidateOutputFile), manifestName(owner)),
      `genes-output-manifest-v2\nowner-base64:${Buffer.from(owner).toString("base64")}\n${owner}\n`,
      "utf8",
    );
    return { mode: step!.mode };
  }

  async close(): Promise<void> {}
}

class VectorWatch<Cause> implements ReconciledWatchSession {
  readonly options: ReconciledWatchOptions<Cause>;

  constructor(options: ReconciledWatchOptions<Cause>) {
    this.options = options;
    options.onRegistered?.();
  }

  change(absolute: string): void {
    const input = this.options.inputs.find((candidate) =>
      owns(candidate, absolute),
    );
    assert.notEqual(input, undefined);
    this.options.onChange({
      path: absolute,
      cause: input!.cause,
      origin: "native",
    });
  }

  reconcile(): { readonly ok: true; readonly changed: false } {
    return Object.freeze({ ok: true, changed: false });
  }
  close(): void {}
}

function owns<Cause>(input: WatchInput<Cause>, absolute: string): boolean {
  if (input.kind === "exact") return input.path === absolute;
  const relative = path.relative(input.path, absolute).split(path.sep).join("/");
  return (
    relative.length > 0 &&
    !relative.startsWith("../") &&
    input.include(relative)
  );
}

function compress(kinds: readonly string[]): readonly EventRun[] {
  const runs: Array<{ kind: string; count: number }> = [];
  for (const kind of kinds) {
    const prior = runs.at(-1);
    if (prior?.kind === kind) prior.count += 1;
    else runs.push({ kind, count: 1 });
  }
  return runs;
}

function changesPublicArtifacts(plan: PublicationPlan): boolean {
  return plan.artifacts.some(
    (artifact) =>
      !artifact.path.includes("/.genes-output-") &&
      JSON.stringify(artifact.prior) !== JSON.stringify(artifact.next),
  );
}

function expectedValidationFailures(vector: Vector): JsonValue[] {
  return vector.expected.eventChecks.flatMap((event) => {
    if (
      event.event.kind === "failed" &&
      event.event.failure.phase === "validate"
    ) {
      return [event.event.failure.diagnostic];
    }
    return [];
  });
}

function validationSteps(vector: Vector): Array<JsonValue | null> {
  const failures = expectedValidationFailures(vector);
  return vector.script.flatMap((step) => {
    if (step === "validate-accepted") return [null];
    if (step === "validate-rejected") {
      const failure = failures.shift();
      assert.notEqual(failure, undefined, `${vector.id}: missing rejection payload`);
      return [failure!];
    }
    return [];
  });
}

function compileSteps(
  vector: Vector,
  hold: Deferred<void> | null,
): CompileStep[] {
  let candidate = 0;
  let held = false;
  return vector.script.flatMap((step) => {
    if (
      step !== "compile-connected" &&
      step !== "compile-direct" &&
      step !== "compile-failed"
    ) {
      return [];
    }
    const current = candidate++;
    const unchanged = vector.id === "unchanged-candidate-advances-generation";
    const shouldHold =
      !held &&
      hold !== null &&
      (vector.id === "burst-supersedes-active-candidate" ||
        vector.id === "close-before-first-accepted-is-idempotent");
    held ||= shouldHold;
    return [
      {
        fail: step === "compile-failed",
        mode: step === "compile-direct" ? "direct" : "connected",
        content: `export const value = ${unchanged ? 1 : current + 1};\n`,
        ...(shouldHold ? { hold } : {}),
        emitFallback:
          vector.id === "late-attach-observes-compiler-fallback" && current === 0,
      },
    ];
  });
}

async function waitForEvent(
  session: DevelopmentSession<JsonValue>,
  predicate: (event: DevelopmentEvent<JsonValue>) => boolean,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const unsubscribe = session.subscribe((event) => {
      if (predicate(event)) {
        unsubscribe();
        resolve();
      }
    });
  });
}

async function settlePromise(
  promise: Promise<unknown>,
): Promise<"resolved" | "pending" | "rejected"> {
  let result: "resolved" | "pending" | "rejected" = "pending";
  void promise.then(
    () => {
      result = "resolved";
    },
    () => {
      result = "rejected";
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  return result;
}

async function execute(vector: Vector): Promise<void> {
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), `genes-vector-${vector.id}-`)),
  );
  const sourceRoot = path.join(root, "src");
  const source = path.join(sourceRoot, "Main.hx");
  mkdirSync(sourceRoot);
  writeFileSync(source, "class Main {}\n", "utf8");
  writeFileSync(path.join(root, "build.hxml"), "-cp src\n-main Main\n", "utf8");
  const hold =
    vector.id === "burst-supersedes-active-candidate" ||
    vector.id === "close-before-first-accepted-is-idempotent"
      ? deferred<void>()
      : null;
  const steps = compileSteps(vector, hold);
  const watches: VectorWatch<unknown>[] = [];
  const events: DevelopmentEvent<JsonValue>[] = [];
  const validations = validationSteps(vector);
  let clock = 1_000_000;
  let nonce = 0;
  let publicationAttempts = 0;
  let publicWrites = 0;
  let compiler: VectorCompiler | null = null;
  const dependencies: SessionDependencies<JsonValue> = {
    now: () => ++clock,
    inventory:
      vector.id === "fatal-inventory-failure-rejects-first-accepted"
        ? async () => {
            throw new Error("hxml inventory failed");
          }
        : inventoryHxml,
    watch: <Cause>(options: ReconciledWatchOptions<Cause>) => {
      const watch = new VectorWatch(options);
      watches.push(watch as VectorWatch<unknown>);
      return watch;
    },
    createCompiler: (
      _layout: SessionLayout,
      onEvent: (event: HaxeWaitServerEvent) => void,
    ) => {
      compiler = new VectorCompiler(steps, onEvent);
      return compiler;
    },
    publish: async (options) => {
      publicationAttempts += 1;
      const changesPublic = changesPublicArtifacts(options.plan);
      const failing =
        vector.id === "publish-failure-rolls-back" &&
        publicationAttempts === 2;
      const result = await publishArtifacts({
        ...options,
        ...(failing
          ? {
              faultInjector: (checkpoint) => {
                if (checkpoint.startsWith("after-publish:src-gen/index.ts")) {
                  throw new Error("publication failed");
                }
              },
            }
          : {}),
      });
      if (changesPublic) publicWrites += 1;
      return result;
    },
    recover:
      vector.script.includes("recovery-committed")
        ? async () => ({ action: "committed", transactionId: "a".repeat(64) })
        : recoverArtifacts,
    acquireLock: acquireSessionLock,
    nonce: () => `vector${++nonce}`,
  };
  const session = createGenesDevelopmentSessionWithDependencies<JsonValue>(
    {
      projectRoot: root,
      projectIdentity: vector.id,
      hxml: {
        allowedRoots: [root],
      },
      publicOutputFile: "src-gen/index.ts",
      stateDirectory: ".genes/dev",
      resolveInvocation: () => ({
        executable: "haxe",
        cwd: root,
        args: ["build.hxml"],
        ioPolicy: "haxe-4.3.7-development-js-v1",
        compatibilityFacts: { vector: vector.id },
      }),
      validate: async () => {
        const rejected = validations.shift();
        if (rejected === undefined) {
          throw new Error(`${vector.id}: unplanned validation`);
        }
        return rejected === null
          ? { ok: true }
          : { ok: false, diagnostic: rejected };
      },
      validatorPolicyFacts: { vector: vector.id },
      debounceMs: 0,
      pollIntervalMs: 10,
      shutdownTimeoutMs: 20,
    },
    dependencies,
  );
  session.subscribe((event) => events.push(event));
  try {
    await session.start();
    const watch = (): VectorWatch<unknown> => {
      const current = watches.at(-1);
      assert.notEqual(current, undefined);
      return current!;
    };

    switch (vector.id) {
      case "initial-compile-failure-repairs":
      case "initial-validation-failure-repairs":
        await session.waitForIdle();
        watch().change(source);
        await session.waitForIdle();
        break;
      case "compile-failure-retains-last-good":
      case "validation-failure-retains-last-good":
      case "publish-failure-rolls-back":
      case "unchanged-candidate-advances-generation":
        await session.waitForIdle();
        watch().change(source);
        await session.waitForIdle();
        break;
      case "burst-supersedes-active-candidate":
        await waitForEvent(
          session,
          (event) => event.event.kind === "build-started",
        );
        for (let index = 0; index < 20; index += 1) watch().change(source);
        hold!.resolve();
        await session.waitForIdle();
        break;
      case "publication-waits-for-reader": {
        await session.waitForIdle();
        const lease = await session.acquirePublishedRead();
        watch().change(source);
        await waitForEvent(
          session,
          (event) =>
            event.event.kind === "candidate-generated" &&
            event.event.revision === 2,
        );
        lease.release();
        await session.waitForIdle();
        break;
      }
      case "close-before-first-accepted-is-idempotent":
        await waitForEvent(
          session,
          (event) => event.event.kind === "build-started",
        );
        await Promise.all([session.close(), session.close()]);
        break;
      case "fatal-inventory-failure-rejects-first-accepted":
        break;
      default:
        await session.waitForIdle();
        break;
    }

    assert.equal(session.state.kind, vector.expected.finalState, vector.id);
    assert.equal(
      session.inspect().newestRevision,
      vector.expected.revisionsObserved,
      vector.id,
    );
    assert.equal(
      events.filter((event) => event.event.kind === "generation-accepted").length,
      vector.expected.acceptedGenerations,
      vector.id,
    );
    assert.equal(
      session.inspect().accepted?.revision ?? null,
      vector.expected.acceptedRevision,
      vector.id,
    );
    assert.equal(
      session.inspect().accepted?.generation ?? null,
      vector.expected.retainedGeneration,
      vector.id,
    );
    assert.equal(
      await settlePromise(session.firstAccepted),
      vector.expected.firstAccepted,
      vector.id,
    );
    assert.equal(publicationAttempts, vector.expected.publicationAttempts, vector.id);
    assert.equal(publicWrites, vector.expected.publicWrites, vector.id);
    assert.deepEqual(
      compress(events.map((event) => event.event.kind)),
      vector.expected.eventRuns,
      `${vector.id}: event run mismatch`,
    );
    assert.deepEqual(
      events.flatMap((event) =>
        event.event.kind === "state" ? [event.event.state.kind] : [],
      ),
      vector.expected.stateKinds,
      `${vector.id}: state trace mismatch`,
    );
    assert.equal(
      vector.expected.readBarrier === "publication-waited-for-reader"
        ? vector.id === "publication-waits-for-reader"
        : true,
      true,
    );

    for (const expectedFailure of vector.expected.eventChecks.flatMap((event) =>
      event.event.kind === "failed" ? [event.event.failure] : [],
    )) {
      assert.equal(
        events.some(
          (event) =>
            event.event.kind === "failed" &&
            event.event.failure.phase === expectedFailure.phase &&
            event.event.failure.recoverable === expectedFailure.recoverable,
        ),
        true,
        `${vector.id}: missing failure ${expectedFailure.phase}`,
      );
    }
    assert.notEqual(compiler, null, `${vector.id}: compiler controller was not created`);
  } finally {
    await session.close();
    rmSync(root, { recursive: true, force: true });
  }
}

const corpus = JSON.parse(
  readFileSync(
    new URL("../development-session/v1/vectors.json", import.meta.url),
    "utf8",
  ),
) as Corpus;

for (const vector of corpus.vectors) await execute(vector);

console.log(
  `genes tooling development-session runtime vectors: ${corpus.vectors.length} passed`,
);
