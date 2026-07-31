import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { publishArtifacts, recoverArtifacts } from "./artifacts/index.js";
import { inventoryHxml } from "./hxml/index.js";
import type {
  HaxeWaitServerEvent,
} from "./haxe-server/index.js";
import type {
  ReconciledWatchChange,
  ReconciledWatchOptions,
  ReconciledWatchSession,
  WatchInput,
} from "./watch/index.js";
import {
  HaxeSessionCompiler,
  type SessionCompiler,
} from "./session/haxe-driver.js";
import { resolveSessionLayout, type SessionLayout } from "./session/layout.js";
import {
  createGenesDevelopmentSessionWithDependencies,
  type SessionDependencies,
} from "./session/runtime.js";
import { acquireSessionLock } from "./session/session-lock.js";
import type {
  DevelopmentEvent,
  DevelopmentSession,
  GenesDevelopmentOptions,
  JsonValue,
} from "./session/types.js";

interface TestDiagnostic {
  readonly [key: string]: JsonValue;
  readonly code: string;
  readonly message: string;
}

interface CompileStep {
  readonly content?: string;
  readonly extraFiles?: Readonly<Record<string, string>>;
  readonly fail?: string;
  readonly hold?: Deferred<void>;
  readonly mode?: "connected" | "direct";
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolvePromise: ((value: Value) => void) | null = null;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value): void {
      resolvePromise!(value);
    },
  };
}

function manifestName(owner: string): string {
  let sanitized = "";
  for (let index = 0; index < owner.length; index += 1) {
    const code = owner.charCodeAt(index);
    const allowed =
      (code >= 97 && code <= 122) ||
      (code >= 65 && code <= 90) ||
      (code >= 48 && code <= 57) ||
      code === 45 ||
      code === 95 ||
      code === 46;
    sanitized += allowed ? owner[index] : "_";
  }
  const readable = sanitized.slice(0, 48);
  const digest = createHash("sha256").update(owner).digest("hex");
  return `.genes-output-${readable}-${digest}.manifest`;
}

assert.match(
  manifestName("entry-🚀.ts"),
  /^\.genes-output-entry-__\.ts-/u,
  "tooling must use the compiler's UTF-16 manifest scope spelling",
);

class FakeCompiler implements SessionCompiler {
  readonly steps: CompileStep[] = [];
  readonly modes: Array<"connected" | "direct"> = [];
  readonly compatibilityDigests: string[] = [];
  closed = 0;

  async compile(
    _invocation: Parameters<SessionCompiler["compile"]>[0],
    compatibilityDigest: string,
    candidateOutputFile: string,
    signal: AbortSignal,
  ): Promise<{ readonly mode: "connected" | "direct" }> {
    const step = this.steps.shift() ?? { content: "export const value = 1;\n" };
    if (step.hold !== undefined) {
      await Promise.race([
        step.hold.promise,
        new Promise<never>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new Error("fake compilation cancelled")),
            { once: true },
          ),
        ),
      ]);
    }
    if (step.fail !== undefined) throw new Error(step.fail);
    this.compatibilityDigests.push(compatibilityDigest);
    const content = step.content ?? "export const value = 1;\n";
    mkdirSync(path.dirname(candidateOutputFile), { recursive: true });
    writeFileSync(candidateOutputFile, content, "utf8");
    const entries = [path.basename(candidateOutputFile)];
    for (const [relative, bytes] of Object.entries(step.extraFiles ?? {})) {
      const absolute = path.join(path.dirname(candidateOutputFile), ...relative.split("/"));
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, bytes, "utf8");
      entries.push(relative);
    }
    entries.sort();
    const owner = path.basename(candidateOutputFile);
    writeFileSync(
      path.join(path.dirname(candidateOutputFile), manifestName(owner)),
      `genes-output-manifest-v2\nowner-base64:${Buffer.from(owner).toString("base64")}\n${entries.join("\n")}\n`,
      "utf8",
    );
    const mode = step.mode ?? "connected";
    this.modes.push(mode);
    return { mode };
  }

  async close(): Promise<void> {
    this.closed += 1;
  }
}

class FakeWatch<Cause> implements ReconciledWatchSession {
  readonly options: ReconciledWatchOptions<Cause>;
  closed = false;

  constructor(options: ReconciledWatchOptions<Cause>) {
    this.options = options;
    options.onRegistered?.();
  }

  change(absolutePath: string): void {
    const input = this.options.inputs.find((candidate) =>
      matches(candidate, absolutePath),
    );
    assert.notEqual(input, undefined, `no fake watch input owns ${absolutePath}`);
    const change: ReconciledWatchChange<Cause> = {
      path: absolutePath,
      cause: input!.cause,
      origin: "native",
    };
    this.options.onChange(change);
  }

  reconcile(): void {}

  close(): void {
    this.closed = true;
  }
}

function matches<Cause>(input: WatchInput<Cause>, absolute: string): boolean {
  if (input.kind === "exact") return input.path === absolute;
  const relative = path.relative(input.path, absolute).split(path.sep).join("/");
  return (
    relative.length > 0 &&
    !relative.startsWith("../") &&
    input.include(relative)
  );
}

interface Harness {
  readonly root: string;
  readonly source: string;
  readonly compiler: FakeCompiler;
  readonly watches: FakeWatch<unknown>[];
  readonly events: DevelopmentEvent<TestDiagnostic>[];
  readonly session: DevelopmentSession<TestDiagnostic>;
  rejectNextValidation(diagnostic: TestDiagnostic): void;
}

function makeHarness(
  name: string,
  configure?: (
    dependencies: SessionDependencies<TestDiagnostic>,
    root: string,
  ) => SessionDependencies<TestDiagnostic>,
): Harness {
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), `genes-session-${name}-`)),
  );
  const sourceRoot = path.join(root, "src");
  const source = path.join(sourceRoot, "Main.hx");
  mkdirSync(sourceRoot);
  writeFileSync(source, "class Main {}\n", "utf8");
  writeFileSync(path.join(root, "build.hxml"), "-cp src\n-main Main\n-js ignored.js\n", "utf8");
  const compiler = new FakeCompiler();
  const watches: FakeWatch<unknown>[] = [];
  let clock = 1_000_000;
  let nonce = 0;
  const base: SessionDependencies<TestDiagnostic> = {
    now: () => ++clock,
    inventory: inventoryHxml,
    watch: <Cause>(options: ReconciledWatchOptions<Cause>) => {
      const watch = new FakeWatch(options);
      watches.push(watch as FakeWatch<unknown>);
      return watch;
    },
    createCompiler: (
      _layout: SessionLayout,
      _onEvent: (event: HaxeWaitServerEvent) => void,
      _shutdownTimeoutMs: number,
    ) => compiler,
    publish: publishArtifacts,
    recover: recoverArtifacts,
    acquireLock: acquireSessionLock,
    nonce: () => `test${++nonce}`,
  };
  const dependencies = configure?.(base, root) ?? base;
  const validation: Array<{ ok: false; diagnostic: TestDiagnostic }> = [];
  const options: GenesDevelopmentOptions<TestDiagnostic> = {
    projectRoot: root,
    projectIdentity: `fixture-${name}`,
    hxml: {
      entryFiles: ["build.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
    },
    publicOutputFile: "src-gen/index.ts",
    stateDirectory: ".genes/dev",
    resolveInvocation: () => ({
      executable: "haxe",
      cwd: root,
      args: ["build.hxml"],
      compatibilityFacts: { version: "fixture" },
    }),
    validate: async () => validation.shift() ?? { ok: true },
    validatorPolicyFacts: { policy: "fixture" },
    debounceMs: 0,
    pollIntervalMs: 10,
    shutdownTimeoutMs: 20,
  };
  const session = createGenesDevelopmentSessionWithDependencies(
    options,
    dependencies,
  );
  const events: DevelopmentEvent<TestDiagnostic>[] = [];
  session.subscribe((event) => events.push(event));
  return {
    root,
    source,
    compiler,
    watches,
    events,
    session,
    rejectNextValidation(diagnostic): void {
      validation.push({ ok: false, diagnostic });
    },
  };
}

function currentWatch(harness: Harness): FakeWatch<unknown> {
  const watch = harness.watches.at(-1);
  assert.notEqual(watch, undefined);
  return watch!;
}

function eventKinds(harness: Harness): string[] {
  return harness.events.map((event) => event.event.kind);
}

async function withHarness(
  name: string,
  run: (harness: Harness) => Promise<void>,
  configure?: (
    dependencies: SessionDependencies<TestDiagnostic>,
    root: string,
  ) => SessionDependencies<TestDiagnostic>,
): Promise<void> {
  const harness = makeHarness(name, configure);
  try {
    await run(harness);
  } finally {
    await harness.session.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
}

await withHarness("initial", async (harness) => {
  harness.compiler.steps.push({ content: "export const value = 1;\n" });
  assert.throws(
    () =>
      harness.session.invalidate({
        path: "src/Main.hx",
        impact: { rebuild: true },
      }),
    /has not started/u,
  );
  const firstStart = harness.session.start();
  const secondStart = harness.session.start();
  assert.equal(firstStart, secondStart, "concurrent start calls share one barrier");
  await firstStart;
  await harness.session.waitForIdle();
  assert.equal(harness.session.state.kind, "ready");
  assert.equal((await harness.session.firstAccepted).generation, 1);
  assert.equal(
    readFileSync(path.join(harness.root, "src-gen/index.ts"), "utf8"),
    "export const value = 1;\n",
  );
  assert.deepEqual(eventKinds(harness), [
    "state",
    "build-started",
    "candidate-generated",
    "state",
    "generation-accepted",
  ]);
});

await withHarness("validation-repair", async (harness) => {
  harness.rejectNextValidation({ code: "TS", message: "not assignable" });
  harness.compiler.steps.push(
    { content: "export const value: number = 'bad';\n" },
    { content: "export const value = 2;\n" },
  );
  await harness.session.start();
  await harness.session.waitForIdle();
  assert.equal(harness.session.state.kind, "blocked");
  assert.equal(existsSync(path.join(harness.root, "src-gen/index.ts")), false);
  currentWatch(harness).change(harness.source);
  await harness.session.waitForIdle();
  assert.equal(harness.session.state.kind, "ready");
  assert.equal((await harness.session.firstAccepted).revision, 2);
});

await withHarness("last-good", async (harness) => {
  harness.compiler.steps.push(
    { content: "export const value = 1;\n" },
    { fail: "Haxe source error" },
  );
  await harness.session.start();
  await harness.session.waitForIdle();
  currentWatch(harness).change(harness.source);
  await harness.session.waitForIdle();
  assert.equal(harness.session.state.kind, "degraded");
  assert.equal(
    readFileSync(path.join(harness.root, "src-gen/index.ts"), "utf8"),
    "export const value = 1;\n",
  );
});

await withHarness("burst", async (harness) => {
  const hold = deferred<void>();
  harness.compiler.steps.push(
    { content: "export const stale = true;\n", hold },
    { content: "export const latest = true;\n" },
  );
  await harness.session.start();
  await new Promise<void>((resolve) => {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.event.kind === "build-started") {
        unsubscribe();
        resolve();
      }
    });
  });
  for (let index = 0; index < 20; index += 1) {
    currentWatch(harness).change(harness.source);
  }
  hold.resolve();
  await harness.session.waitForIdle();
  assert.equal(harness.session.inspect().newestRevision, 21);
  assert.equal((await harness.session.firstAccepted).revision, 21);
  assert.equal(
    harness.compiler.modes.length,
    2,
    "20 edits during one active build must collapse into one newest-state follow-up",
  );
  assert.equal(
    harness.events.filter((event) => event.event.kind === "candidate-superseded").length,
    1,
  );
});

await withHarness("read-gate", async (harness) => {
  harness.compiler.steps.push(
    { content: "export const value = 1;\n" },
    { content: "export const value = 2;\n" },
  );
  await harness.session.start();
  await harness.session.waitForIdle();
  const lease = await harness.session.acquirePublishedRead();
  currentWatch(harness).change(harness.source);
  await new Promise<void>((resolve) => {
    const unsubscribe = harness.session.subscribe((event) => {
      if (
        event.event.kind === "candidate-generated" &&
        event.event.revision === 2
      ) {
        unsubscribe();
        resolve();
      }
    });
  });
  assert.equal(
    readFileSync(path.join(harness.root, "src-gen/index.ts"), "utf8"),
    "export const value = 1;\n",
  );
  lease.release();
  lease.release();
  await harness.session.waitForIdle();
  assert.equal(
    readFileSync(path.join(harness.root, "src-gen/index.ts"), "utf8"),
    "export const value = 2;\n",
  );
});

{
  const publicationEntered = deferred<void>();
  const releasePublication = deferred<void>();
  await withHarness(
    "read-generation",
    async (harness) => {
      harness.compiler.steps.push(
        { content: "export const value = 1;\n" },
        { content: "export const value = 2;\n" },
      );
      await harness.session.start();
      await harness.session.waitForIdle();
      currentWatch(harness).change(harness.source);
      await publicationEntered.promise;
      const readAfterPublication = harness.session.acquirePublishedRead();
      releasePublication.resolve();
      const lease = await readAfterPublication;
      assert.equal(
        lease.generation,
        2,
        "a reader queued behind publication must describe the committed generation",
      );
      lease.release();
      await harness.session.waitForIdle();
    },
    (dependencies) => {
      let publications = 0;
      return {
        ...dependencies,
        publish: async (options) => {
          publications += 1;
          if (publications === 2) {
            publicationEntered.resolve();
            await releasePublication.promise;
          }
          return await publishArtifacts(options);
        },
      };
    },
  );
}

await withHarness("unchanged", async (harness) => {
  harness.compiler.steps.push(
    { content: "export const value = 1;\n" },
    { content: "export const value = 1;\n" },
  );
  await harness.session.start();
  await harness.session.waitForIdle();
  currentWatch(harness).change(harness.source);
  await harness.session.waitForIdle();
  const accepted = await harness.session.firstAccepted;
  assert.equal(accepted.generation, 1);
  assert.equal(harness.session.inspect().accepted?.generation, 2);
  assert.deepEqual(harness.session.inspect().accepted?.files, {
    created: [],
    updated: [],
    deleted: [],
  });
});

await withHarness("rollback", async (harness) => {
  harness.compiler.steps.push(
    { content: "export const value = 1;\n" },
    { content: "export const value = 2;\n" },
  );
  await harness.session.start();
  await harness.session.waitForIdle();
  currentWatch(harness).change(harness.source);
  await harness.session.waitForIdle();
  assert.equal(harness.session.state.kind, "degraded");
  assert.equal(
    readFileSync(path.join(harness.root, "src-gen/index.ts"), "utf8"),
    "export const value = 1;\n",
  );
}, (dependencies) => {
  let publications = 0;
  return {
    ...dependencies,
    publish: async (options) => {
      publications += 1;
      return await publishArtifacts({
        ...options,
        ...(publications === 2
          ? {
              faultInjector: (checkpoint) => {
                if (checkpoint.startsWith("after-publish:src-gen/index.ts")) {
                  throw new Error("injected publication failure");
                }
              },
            }
          : {}),
      });
    },
  };
});

await withHarness("stale-ownership", async (harness) => {
  harness.compiler.steps.push(
    {
      content: "export const value = 1;\n",
      extraFiles: {
        "chunks/old.ts": "export const old = true;\n",
      },
    },
    { content: "export const value = 2;\n" },
  );
  await harness.session.start();
  await harness.session.waitForIdle();
  const unowned = path.join(harness.root, "src-gen/notes.txt");
  writeFileSync(unowned, "keep me\n", "utf8");
  assert.equal(existsSync(path.join(harness.root, "src-gen/chunks/old.ts")), true);
  currentWatch(harness).change(harness.source);
  await harness.session.waitForIdle();
  assert.equal(existsSync(path.join(harness.root, "src-gen/chunks/old.ts")), false);
  assert.equal(readFileSync(unowned, "utf8"), "keep me\n");
  assert.deepEqual(harness.session.inspect().accepted?.files.deleted, [
    "src-gen/chunks/old.ts",
  ]);
});

await withHarness("public-drift", async (harness) => {
  harness.compiler.steps.push(
    { content: "export const value = 1;\n" },
    { content: "export const value = 2;\n" },
  );
  await harness.session.start();
  await harness.session.waitForIdle();
  const publicEntry = path.join(harness.root, "src-gen/index.ts");
  writeFileSync(publicEntry, "// manual edit\n", "utf8");
  currentWatch(harness).change(harness.source);
  await harness.session.waitForIdle();
  assert.equal(harness.session.state.kind, "degraded");
  assert.equal(readFileSync(publicEntry, "utf8"), "// manual edit\n");
  const failure = harness.events
    .filter((event) => event.event.kind === "failed")
    .at(-1);
  assert.equal(failure?.event.kind, "failed");
  if (failure?.event.kind === "failed") {
    assert.equal(failure.event.failure.phase, "publish");
    assert.match(
      String(failure.event.failure.diagnostic.message),
      /public generated tree changed/u,
    );
  }
});

await withHarness("identity-rotation", async (harness) => {
  harness.compiler.steps.push(
    { content: "export const value = 1;\n" },
    { content: "export const value = 2;\n" },
  );
  await harness.session.start();
  await harness.session.waitForIdle();
  writeFileSync(
    path.join(harness.root, "build.hxml"),
    "-cp src\n-main Main\n-js ignored.js\n-D changed-identity\n",
    "utf8",
  );
  currentWatch(harness).change(path.join(harness.root, "build.hxml"));
  await harness.session.waitForIdle();
  assert.equal(harness.compiler.compatibilityDigests.length, 2);
  assert.notEqual(
    harness.compiler.compatibilityDigests[0],
    harness.compiler.compatibilityDigests[1],
  );
  assert.equal(harness.watches.length >= 2, true);
  assert.equal(harness.watches[0]!.closed, true);
});

await withHarness("registration-gap", async (harness) => {
  harness.compiler.steps.push({ content: "export const value = 1;\n" });
  await harness.session.start();
  await harness.session.waitForIdle();
  assert.equal(harness.watches.length, 2);
  assert.equal(harness.watches[0]!.closed, true);
  assert.equal(harness.session.state.kind, "ready");
}, (dependencies, root) => {
  let inventoryCalls = 0;
  return {
    ...dependencies,
    inventory: async (options) => {
      inventoryCalls += 1;
      if (inventoryCalls === 2) {
        const secondSource = path.join(root, "src-next");
        mkdirSync(secondSource);
        writeFileSync(path.join(secondSource, "Main.hx"), "class Main {}\n", "utf8");
        writeFileSync(
          path.join(root, "build.hxml"),
          "-cp src-next\n-main Main\n-js ignored.js\n",
          "utf8",
        );
      }
      return await inventoryHxml(options);
    },
  };
});

await withHarness("input-overlap", async (harness) => {
  const invalidInput = path.join(harness.root, ".genes/dev/authored");
  mkdirSync(invalidInput, { recursive: true });
  writeFileSync(path.join(invalidInput, "Main.hx"), "class Main {}\n", "utf8");
  writeFileSync(
    path.join(harness.root, "build.hxml"),
    "-cp .genes/dev/authored\n-main Main\n-js ignored.js\n",
    "utf8",
  );
  await harness.session.start();
  assert.equal(harness.session.state.kind, "blocked");
  if (harness.session.state.kind === "blocked") {
    assert.equal(harness.session.state.failure.phase, "inventory");
    assert.equal(harness.session.state.failure.recoverable, false);
    assert.match(
      String(harness.session.state.failure.diagnostic.message),
      /overlaps state or generated output/u,
    );
  }
  await assert.rejects(harness.session.firstAccepted, /fatal session failure/u);
});

{
  const recoveryEntered = deferred<void>();
  const releaseRecovery = deferred<void>();
  const harness = makeHarness("close-during-start", (dependencies) => ({
    ...dependencies,
    recover: async (options) => {
      recoveryEntered.resolve();
      await releaseRecovery.promise;
      return await recoverArtifacts(options);
    },
  }));
  try {
    const starting = harness.session.start();
    await recoveryEntered.promise;
    const closing = harness.session.close();
    releaseRecovery.resolve();
    await Promise.all([starting, closing]);
    assert.equal(harness.session.state.kind, "closed");
    assert.equal(harness.watches.length, 0);
    assert.equal(harness.compiler.closed, 1);
    const layout = resolveSessionLayout(
      harness.root,
      "fixture-close-during-start",
      "src-gen/index.ts",
      ".genes/dev",
    );
    assert.equal(
      existsSync(
        path.join(harness.root, ...layout.sessionLockRelative.split("/")),
      ),
      false,
    );
    await assert.rejects(harness.session.firstAccepted, /closed before/u);
  } finally {
    await harness.session.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
}

{
  const harness = makeHarness("single-writer");
  try {
    await harness.session.start();
    await harness.session.waitForIdle();
    const competingLayout = resolveSessionLayout(
      harness.root,
      "fixture-single-writer",
      "src-gen/index.ts",
      ".genes/other-session-state",
    );
    const lockPath = path.join(
      harness.root,
      ...competingLayout.sessionLockRelative.split("/"),
    );
    assert.equal(existsSync(lockPath), true);
    assert.throws(
      () => acquireSessionLock(competingLayout),
      /already owns/u,
    );
  } finally {
    await harness.session.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
}

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-layout-")),
  );
  try {
    assert.throws(
      () =>
        resolveSessionLayout(
          root,
          "invalid-overlap",
          "src-gen/index.ts",
          "src-gen/.genes",
        ),
      /must not overlap/u,
      "private state must never live below the public generated tree",
    );
    assert.throws(
      () =>
        resolveSessionLayout(
          root,
          "invalid-escape",
          "../outside/index.ts",
          ".genes/dev",
        ),
      /escapes projectRoot/u,
      "the public output must stay inside the project ownership root",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-invocation-")),
  );
  try {
    const layout = resolveSessionLayout(
      root,
      "invalid-invocation",
      "src-gen/index.ts",
      ".genes/dev",
    );
    const compiler = new HaxeSessionCompiler(layout, () => undefined, 20);
    const abort = new AbortController();
    await assert.rejects(
      compiler.compile(
        {
          executable: "haxe",
          cwd: root,
          args: ["build.hxml", "--connect", "6000"],
          compatibilityFacts: { fixture: "forbidden-connect" },
        },
        "invalid",
        path.join(root, ".genes/dev/candidate/index.ts"),
        abort.signal,
      ),
      /must not contain compiler-server flags/u,
    );
    await assert.rejects(
      compiler.compile(
        {
          executable: "haxe",
          cwd: root,
          args: ["build.hxml", "-D", "genes.output=stolen.ts"],
          compatibilityFacts: { fixture: "forbidden-output" },
        },
        "invalid",
        path.join(root, ".genes/dev/candidate/index.ts"),
        abort.signal,
      ),
      /must not define genes\.output/u,
    );
    await compiler.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log("genes tooling development session runtime: ok");
