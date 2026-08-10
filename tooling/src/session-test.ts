import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARTIFACT_PLAN_PROTOCOL,
  ARTIFACT_PLAN_VERSION,
  canonicalDigest,
  canonicalJson,
  publishArtifacts,
  recoverArtifacts,
  sha256Bytes,
  type CanonicalJson,
  type PublicationPlan,
} from "./artifacts/index.js";
import { inventoryHxml } from "./hxml/index.js";
import { establishSessionAuthority } from "./session/authority-migration.js";
import type {
  HaxeWaitServerEvent,
} from "./haxe-server/index.js";
import type {
  ReconciledWatchChange,
  ReconciledWatchOptions,
  ReconciledWatchSession,
  ReconciliationResult,
  WatchInput,
} from "./watch/index.js";
import {
  HaxeSessionCompiler,
  snapshotHaxeInvocation,
  type PreparedCompilerRequest,
  type SessionCompiler,
} from "./session/haxe-driver.js";
import { readGenesOutput } from "./session/genes-output.js";
import {
  resolveSessionLayout,
  samePhysicalSessionPath,
  type SessionLayout,
} from "./session/layout.js";
import {
  recoveredArtifactsMatchPublishedFiles,
} from "./session/prepared-files.js";
import {
  acceptedGenerationBytes,
  admissionDigest,
  readPublishedMarker,
  sessionProjectDigest,
} from "./session/publication.js";
import {
  createGenesDevelopmentSessionWithDependencies,
  type SessionDependencies,
} from "./session/runtime.js";
import {
  acquireSessionLock,
  claimSessionRootOwner,
} from "./session/session-lock.js";
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
  readonly fail?:
    | string
    | ((candidateOutputFile: string) => string);
  readonly hold?: Deferred<void>;
  readonly mode?: "connected" | "direct";
  readonly afterGenerate?: (outputRoot: string, owner: string) => void;
  readonly beforeInvocationGuard?: () => void;
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

function legacyControlPaths(layout: SessionLayout): {
  readonly marker: string;
  readonly lock: string;
  readonly transactions: string;
} {
  const scope = createHash("sha256")
    .update(layout.publicEntryAuthority)
    .digest("hex");
  const control = `.genes/tooling/session-publications/${scope}`;
  return Object.freeze({
    marker: `${control}/accepted-generation.json`,
    lock: `.genes/tooling/session-locks/${scope}.json`,
    transactions: `${control}/transactions`,
  });
}

function seedOwnedOutput(
  layout: SessionLayout,
  content: string,
): NonNullable<ReturnType<typeof readGenesOutput>> {
  mkdirSync(layout.publicOutputRoot, { recursive: true });
  writeFileSync(layout.publicOutputFile, content, "utf8");
  writeFileSync(
    path.join(layout.publicOutputRoot, manifestName(layout.outputIdentity)),
    `genes-output-manifest-v2\nowner-base64:${Buffer.from(layout.outputIdentity).toString("base64")}\n${layout.outputIdentity}\n`,
    "utf8",
  );
  return readGenesOutput(
    layout.publicOutputRoot,
    layout.outputIdentity,
    true,
  )!;
}

function writeLegacyMarker(
  layout: SessionLayout,
  manifestDigest: string,
): void {
  const relative = legacyControlPaths(layout).marker;
  const absolute = path.join(layout.projectRoot, ...relative.split("/"));
  mkdirSync(path.dirname(absolute), { recursive: true });
  const record = {
    protocol: "genes.tooling.accepted-generation.v1",
    sessionNonce: "legacy-session",
    generation: 1,
    revision: 1,
    acceptedAt: 1,
    manifestDigest,
    publicOutput: layout.publicEntryAuthority,
    publicOutputPath: layout.publicOutputRelative,
  } as const;
  writeFileSync(
    absolute,
    `${canonicalJson(record as unknown as CanonicalJson)}\n`,
    "utf8",
  );
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
  readonly invocations: Parameters<SessionCompiler["compile"]>[0][] = [];
  readonly preparedRequests: PreparedCompilerRequest[] = [];
  calls = 0;
  closed = 0;

  async compile(
    _invocation: Parameters<SessionCompiler["compile"]>[0],
    compatibilityDigest: string,
    signal: AbortSignal,
    assertInvocationCurrent?: () => void | Promise<void>,
    prepared?: PreparedCompilerRequest,
  ): Promise<{ readonly mode: "connected" | "direct" }> {
    const { candidateOutputFile } = _invocation;
    this.calls += 1;
    this.invocations.push(_invocation);
    if (prepared !== undefined) {
      this.preparedRequests.push(prepared);
      for (const classPath of prepared.classPaths) {
        assert.equal(
          existsSync(classPath),
          true,
          "prepared class path exists while Haxe compiles",
        );
      }
    }
    const step = this.steps.shift() ?? { content: "export const value = 1;\n" };
    step.beforeInvocationGuard?.();
    await assertInvocationCurrent?.();
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
    if (step.fail !== undefined) {
      throw new Error(
        typeof step.fail === "function"
          ? step.fail(candidateOutputFile)
          : step.fail,
      );
    }
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
    step.afterGenerate?.(path.dirname(candidateOutputFile), owner);
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
  readonly reconciliationResults: ReconciliationResult[] = [];
  readonly reconciliationChanges: string[] = [];

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

  reconcile(): ReconciliationResult {
    const changedPath = this.reconciliationChanges.shift();
    if (changedPath !== undefined) {
      this.change(changedPath);
      return Object.freeze({ ok: true, changed: true });
    }
    return (
      this.reconciliationResults.shift() ??
      Object.freeze({ ok: true, changed: false })
    );
  }

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
  configureOptions?: (
    options: GenesDevelopmentOptions<TestDiagnostic>,
    root: string,
  ) => GenesDevelopmentOptions<TestDiagnostic>,
): Harness {
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), `genes-session-${name}-`)),
  );
  const sourceRoot = path.join(root, "src");
  const source = path.join(sourceRoot, "Main.hx");
  mkdirSync(sourceRoot);
  writeFileSync(source, "class Main {}\n", "utf8");
  writeFileSync(path.join(root, "build.hxml"), "-cp src\n-main Main\n", "utf8");
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
    establishAuthority: async (layout) =>
      await establishSessionAuthority(layout, {
        publish: publishArtifacts,
        recover: recoverArtifacts,
      }),
    nonce: () => `test${++nonce}`,
  };
  const dependencies = configure?.(base, root) ?? base;
  const validation: Array<{ ok: false; diagnostic: TestDiagnostic }> = [];
  const baseOptions: GenesDevelopmentOptions<TestDiagnostic> = {
    projectRoot: root,
    projectIdentity: `fixture-${name}`,
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
      compatibilityFacts: { version: "fixture" },
    }),
    validate: async () => validation.shift() ?? { ok: true },
    validatorPolicyFacts: { policy: "fixture" },
    debounceMs: 0,
    pollIntervalMs: 10,
    shutdownTimeoutMs: 20,
  };
  const options = configureOptions?.(baseOptions, root) ?? baseOptions;
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

function currentState(harness: Harness): DevelopmentSession<TestDiagnostic>["state"] {
  return harness.session.state;
}

async function withHarness(
  name: string,
  run: (harness: Harness) => Promise<void>,
  configure?: (
    dependencies: SessionDependencies<TestDiagnostic>,
    root: string,
  ) => SessionDependencies<TestDiagnostic>,
  configureOptions?: (
    options: GenesDevelopmentOptions<TestDiagnostic>,
    root: string,
  ) => GenesDevelopmentOptions<TestDiagnostic>,
): Promise<void> {
  const harness = makeHarness(name, configure, configureOptions);
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

await withHarness("legacy-entry-state-upgrade", async (harness) => {
  const layout = resolveSessionLayout(
    harness.root,
    "fixture-legacy-entry-state-upgrade",
    "src-gen/index.ts",
    ".genes/dev",
  );
  const legacy = seedOwnedOutput(layout, "export const legacy = true;\n");
  writeLegacyMarker(layout, legacy.manifestDigest);
  harness.compiler.steps.push({ content: "export const current = true;\n" });

  await harness.session.start();
  await harness.session.waitForIdle();

  assert.equal(harness.session.state.kind, "ready");
  assert.equal(
    readFileSync(layout.publicOutputFile, "utf8"),
    "export const current = true;\n",
  );
  assert.equal(
    existsSync(
      path.join(
        harness.root,
        ...layout.generationMarkerRelative.split("/"),
      ),
    ),
    true,
    "the first accepted upgrade must establish the new root-scoped marker",
  );
  const legacyMarker = JSON.parse(
    readFileSync(
      path.join(
        harness.root,
        ...layout.legacyGenerationMarkerRelative.split("/"),
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  assert.equal(
    legacyMarker.protocol,
    "genes.tooling.development-session-legacy-fence.v1",
    "the old entry marker becomes a permanent one-way migration fence",
  );
  assert.equal(
    existsSync(
      path.join(
        harness.root,
        ...layout.authorityMigrationReceiptRelative.split("/"),
      ),
    ),
    true,
    "the migration keeps durable evidence for later restarts",
  );
});

for (const checkpoint of [
  "after-receipt",
  "after-fence",
  "after-owner",
  "after-root-marker",
] as const) {
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), `genes-session-upgrade-${checkpoint}-`)),
  );
  try {
    const layout = resolveSessionLayout(
      root,
      `fixture-upgrade-${checkpoint}`,
      "src-gen/index.ts",
      ".genes/dev",
    );
    const legacy = seedOwnedOutput(layout, "export const legacy = true;\n");
    writeLegacyMarker(layout, legacy.manifestDigest);

    const interruptedLock = acquireSessionLock(layout);
    try {
      await assert.rejects(
        () =>
          establishSessionAuthority(layout, {
            publish: publishArtifacts,
            recover: recoverArtifacts,
            faultInjector: (current) => {
              if (current === checkpoint) {
                throw new Error(`stop after ${checkpoint}`);
              }
            },
          }),
        new RegExp(`stop after ${checkpoint}`, "u"),
      );
    } finally {
      interruptedLock.release();
    }
    assert.equal(
      readFileSync(layout.publicOutputFile, "utf8"),
      "export const legacy = true;\n",
      "an interrupted authority upgrade must preserve the accepted output",
    );

    const restartLock = acquireSessionLock(layout);
    try {
      await establishSessionAuthority(layout, {
        publish: publishArtifacts,
        recover: recoverArtifacts,
      });
    } finally {
      restartLock.release();
    }
    assert.equal(
      readPublishedMarker(layout).manifestDigest,
      legacy.manifestDigest,
      "a restart must finish the root-scoped marker without rebuilding output",
    );
    const fencedLegacy = JSON.parse(
      readFileSync(
        path.join(
          root,
          ...layout.legacyGenerationMarkerRelative.split("/"),
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.equal(
      fencedLegacy.protocol,
      "genes.tooling.development-session-legacy-fence.v1",
      "the old marker must stop an older writer after the upgrade",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  // This is the exact released entry-authority implementation that PR #138
  // upgrades. Building it in isolation prevents this test from accidentally
  // recreating v1 state with today's helper code.
  const legacyRevision = "33ecc1b4476b7090c56cae82775b8ec8d533b898";
  const repositoryRoot = realpathSync.native(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  );
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-origin-main-upgrade-")),
  );
  try {
    const snapshot = path.join(root, "legacy-source");
    const project = path.join(root, "project");
    const archive = path.join(root, "legacy.tar");
    mkdirSync(snapshot);
    mkdirSync(project);
    const archived = spawnSync(
      "git",
      [
        "archive",
        "--format=tar",
        `--output=${archive}`,
        legacyRevision,
        "tooling",
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    assert.equal(archived.status, 0, archived.stderr);
    const extracted = spawnSync("tar", ["-xf", archive, "-C", snapshot], {
      encoding: "utf8",
    });
    assert.equal(extracted.status, 0, extracted.stderr);
    symlinkSync(
      path.join(repositoryRoot, "node_modules"),
      path.join(snapshot, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const compiled = spawnSync(
      "npm",
      ["exec", "--no", "--", "tsc6", "-p", "tooling/tsconfig.json"],
      { cwd: snapshot, encoding: "utf8" },
    );
    assert.equal(
      compiled.status,
      0,
      `released tooling fixture did not compile: ${compiled.stdout}\n${compiled.stderr}`,
    );

    mkdirSync(path.join(project, "src"));
    writeFileSync(path.join(project, "src/Main.hx"), "class Main {}\n", "utf8");
    writeFileSync(path.join(project, "build.hxml"), "-cp src\n-main Main\n", "utf8");
    const legacyFixture = path.join(
      snapshot,
      "tooling/dist/session-crash-fixture.js",
    );
    const legacyCrash = spawnSync(process.execPath, [legacyFixture], {
      cwd: project,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: project,
        GENES_SESSION_CRASH_STATE: ".genes/legacy-state",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
        GENES_SESSION_CRASH_CONTENT: "export const releasedV1 = true;\n",
        GENES_SESSION_CRASH_AT: "after-publish:commit-marker",
      },
      encoding: "utf8",
    });
    assert.equal(
      legacyCrash.status,
      73,
      `released tooling fixture did not stop at its real commit boundary: ${legacyCrash.stderr}`,
    );

    const currentFixture = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "session-crash-fixture.js",
    );
    const upgraded = spawnSync(process.execPath, [currentFixture], {
      cwd: project,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: project,
        GENES_SESSION_CRASH_STATE: ".genes/current-state",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
        GENES_SESSION_CRASH_CONTENT: "export const upgradedV2 = true;\n",
      },
      encoding: "utf8",
    });
    assert.equal(
      upgraded.status,
      0,
      `current tooling could not recover released v1 state: ${upgraded.stderr}`,
    );
    assert.equal(
      readFileSync(path.join(project, "src-gen/index.ts"), "utf8"),
      "export const upgradedV2 = true;\n",
    );
    const layout = resolveSessionLayout(
      project,
      "fixture-alternate-state-recovery",
      "src-gen/index.ts",
      ".genes/current-state",
    );
    const fence = JSON.parse(
      readFileSync(
        path.join(project, ...layout.legacyGenerationMarkerRelative.split("/")),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.equal(
      fence.protocol,
      "genes.tooling.development-session-legacy-fence.v1",
      "the exact released marker becomes the permanent migration fence",
    );
    const downgrade = spawnSync(process.execPath, [legacyFixture], {
      cwd: project,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: project,
        GENES_SESSION_CRASH_STATE: ".genes/downgrade-state",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
        GENES_SESSION_CRASH_CONTENT: "export const downgradedV1 = true;\n",
      },
      encoding: "utf8",
    });
    assert.notEqual(
      downgrade.status,
      0,
      "the permanent fence must stop the released v1 client for the migrated entry",
    );
    assert.equal(
      readFileSync(path.join(project, "src-gen/index.ts"), "utf8"),
      "export const upgradedV2 = true;\n",
      "a rejected downgrade must not change the public output",
    );
    const laterRestart = spawnSync(process.execPath, [currentFixture], {
      cwd: project,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: project,
        GENES_SESSION_CRASH_STATE: ".genes/later-state",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
        GENES_SESSION_CRASH_CONTENT: "export const laterV2 = true;\n",
      },
      encoding: "utf8",
    });
    assert.equal(
      laterRestart.status,
      0,
      `a later v2 generation must not be compared with the historical v1 receipt: ${laterRestart.stderr}`,
    );
    assert.equal(
      readFileSync(path.join(project, "src-gen/index.ts"), "utf8"),
      "export const laterV2 = true;\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-legacy-translation-")),
  );
  try {
    const layout = resolveSessionLayout(
      root,
      "fixture-legacy-translation",
      "src-gen/index.ts",
      ".genes/state",
    );
    const legacy = seedOwnedOutput(layout, "export const legacy = true;\n");
    writeLegacyMarker(layout, legacy.manifestDigest);
    const lock = acquireSessionLock(layout);
    try {
      await establishSessionAuthority(layout, {
        publish: publishArtifacts,
        recover: recoverArtifacts,
      });
      const translated = JSON.parse(
        readFileSync(
          path.join(root, ...layout.generationMarkerRelative.split("/")),
          "utf8",
        ),
      ) as Record<string, unknown>;
      assert.deepEqual(
        {
          sessionNonce: translated.sessionNonce,
          generation: translated.generation,
          revision: translated.revision,
          acceptedAt: translated.acceptedAt,
          manifestDigest: translated.manifestDigest,
        },
        {
          sessionNonce: "legacy-session",
          generation: 1,
          revision: 1,
          acceptedAt: 1,
          manifestDigest: legacy.manifestDigest,
        },
        "translation preserves every accepted-generation fact from v1",
      );
    } finally {
      lock.release();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-legacy-conflict-")),
  );
  try {
    const selected = resolveSessionLayout(
      root,
      "fixture-legacy-conflict",
      "src-gen/index.ts",
      ".genes/state-a",
    );
    const conflicting = resolveSessionLayout(
      root,
      "fixture-legacy-conflict",
      "src-gen/other.ts",
      ".genes/state-b",
    );
    writeLegacyMarker(conflicting, "a".repeat(64));
    const lock = acquireSessionLock(selected);
    try {
      await assert.rejects(
        () =>
          establishSessionAuthority(selected, {
            publish: publishArtifacts,
            recover: recoverArtifacts,
          }),
        /contradictory legacy entry authorities/u,
      );
    } finally {
      lock.release();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-legacy-authentication-")),
  );
  try {
    const layout = resolveSessionLayout(
      root,
      "fixture-legacy-authentication",
      "src-gen/index.ts",
      ".genes/state",
    );
    seedOwnedOutput(layout, "export const accepted = true;\n");
    writeLegacyMarker(layout, "a".repeat(64));
    const lock = acquireSessionLock(layout);
    try {
      await assert.rejects(
        () =>
          establishSessionAuthority(layout, {
            publish: publishArtifacts,
            recover: recoverArtifacts,
          }),
        /does not match the live Genes ownership manifest/u,
        "migration must authenticate the old marker against the live generated tree",
      );
    } finally {
      lock.release();
    }
    assert.equal(
      readFileSync(layout.publicOutputFile, "utf8"),
      "export const accepted = true;\n",
      "an unauthenticated old marker must not change the public output",
    );
    assert.equal(
      existsSync(
        path.join(root, ...layout.authorityMigrationReceiptRelative.split("/")),
      ),
      false,
      "an unauthenticated old marker must not create migration authority",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const corruption of ["receipt", "fence"] as const) {
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), `genes-session-migration-${corruption}-`)),
  );
  try {
    const layout = resolveSessionLayout(
      root,
      `fixture-migration-${corruption}`,
      "src-gen/index.ts",
      ".genes/state",
    );
    const legacy = seedOwnedOutput(layout, "export const accepted = true;\n");
    writeLegacyMarker(layout, legacy.manifestDigest);
    const interrupted = acquireSessionLock(layout);
    try {
      await assert.rejects(
        () =>
          establishSessionAuthority(layout, {
            publish: publishArtifacts,
            recover: recoverArtifacts,
            faultInjector: (checkpoint) => {
              if (checkpoint === `after-${corruption}`) {
                throw new Error(`stop after ${corruption}`);
              }
            },
          }),
        new RegExp(`stop after ${corruption}`, "u"),
      );
    } finally {
      interrupted.release();
    }

    const corruptedRelative =
      corruption === "receipt"
        ? layout.authorityMigrationReceiptRelative
        : layout.legacyGenerationMarkerRelative;
    writeFileSync(
      path.join(root, ...corruptedRelative.split("/")),
      "not canonical migration evidence\n",
      "utf8",
    );

    const restart = acquireSessionLock(layout);
    try {
      await assert.rejects(
        () =>
          establishSessionAuthority(layout, {
            publish: publishArtifacts,
            recover: recoverArtifacts,
          }),
        /migration receipt is not valid JSON|control namespace cannot be audited/u,
        `a corrupt ${corruption} must stop migration`,
      );
    } finally {
      restart.release();
    }
    assert.equal(
      readFileSync(layout.publicOutputFile, "utf8"),
      "export const accepted = true;\n",
      `a corrupt ${corruption} must preserve the accepted output`,
    );
    assert.equal(
      existsSync(path.join(root, ...layout.generationMarkerRelative.split("/"))),
      false,
      `a corrupt ${corruption} must not create root publication authority`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const recoveryRoots: string[] = [];
  await withHarness(
    "legacy-entry-recovery-scan",
    async (harness) => {
      await harness.session.start();
      await harness.session.waitForIdle();
      const layout = resolveSessionLayout(
        harness.root,
        "fixture-legacy-entry-recovery-scan",
        "src-gen/index.ts",
        ".genes/dev",
      );
      assert.deepEqual(recoveryRoots, [
        legacyControlPaths(layout).transactions,
        layout.transactionRelative,
      ]);
    },
    (dependencies) => ({
      ...dependencies,
      recover: async (options) => {
        recoveryRoots.push(options.transactionRoot);
        return await recoverArtifacts(options);
      },
    }),
  );
}

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

await withHarness("no-build-change-during-build", async (harness) => {
  const hold = deferred<void>();
  harness.compiler.steps.push({ content: "export const value = 1;\n", hold });
  const starting = harness.session.start();
  await new Promise<void>((resolve) => {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.event.kind === "build-started") {
        unsubscribe();
        resolve();
      }
    });
  });
  harness.session.invalidate({
    path: "notes.txt",
    impact: { rebuild: false },
  });
  hold.resolve();
  await starting;
  await harness.session.waitForIdle();
  assert.equal(harness.compiler.calls, 1);
  assert.equal(harness.session.state.kind, "ready");
  assert.equal(harness.session.inspect().accepted?.revision, 1);
  assert.equal(harness.session.inspect().newestRevision, 2);
  assert.equal(
    readFileSync(path.join(harness.root, "src-gen/index.ts"), "utf8"),
    "export const value = 1;\n",
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

await withHarness("first-output-collision", async (harness) => {
  const publicEntry = path.join(harness.root, "src-gen/index.ts");
  mkdirSync(path.dirname(publicEntry), { recursive: true });
  writeFileSync(publicEntry, "// authored file\n", "utf8");
  harness.compiler.steps.push({ content: "export const generated = true;\n" });
  await harness.session.start();
  await harness.session.waitForIdle();
  assert.equal(harness.session.state.kind, "blocked");
  assert.equal(readFileSync(publicEntry, "utf8"), "// authored file\n");
  assert.equal(harness.session.inspect().accepted, null);
});

await withHarness("first-manifest-collision", async (harness) => {
  const outputRoot = path.join(harness.root, "src-gen");
  const manifest = path.join(outputRoot, manifestName("index.ts"));
  mkdirSync(outputRoot, { recursive: true });
  const authored = `genes-output-manifest-v2\nowner-base64:${Buffer.from("index.ts").toString("base64")}\n`;
  writeFileSync(manifest, authored, "utf8");
  harness.compiler.steps.push({ content: "export const generated = true;\n" });
  await harness.session.start();
  await harness.session.waitForIdle();
  assert.equal(harness.session.state.kind, "blocked");
  assert.equal(readFileSync(manifest, "utf8"), authored);
  assert.equal(existsSync(path.join(outputRoot, "index.ts")), false);
});

await withHarness("later-unowned-collision", async (harness) => {
  harness.compiler.steps.push(
    { content: "export const value = 1;\n" },
    {
      content: "export const value = 2;\n",
      extraFiles: { "chunks/new.ts": "export const generated = true;\n" },
    },
  );
  await harness.session.start();
  await harness.session.waitForIdle();
  const collision = path.join(harness.root, "src-gen/chunks/new.ts");
  mkdirSync(path.dirname(collision), { recursive: true });
  writeFileSync(collision, "// unowned\n", "utf8");
  currentWatch(harness).change(harness.source);
  await harness.session.waitForIdle();
  assert.equal(harness.session.state.kind, "degraded");
  assert.equal(readFileSync(collision, "utf8"), "// unowned\n");
  assert.equal(harness.session.inspect().accepted?.generation, 1);
});

await withHarness(
  "unresolved-library-closure",
  async (harness) => {
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    assert.equal(harness.compiler.calls, 0);
    assert.equal(existsSync(path.join(harness.root, "src-gen/index.ts")), false);
    await assert.rejects(harness.session.firstAccepted, /fatal session failure/u);
  },
  undefined,
  (options, root) => {
    writeFileSync(
      path.join(root, "build.hxml"),
      "-cp src\n-lib unresolved\n-main Main\n",
      "utf8",
    );
    return options;
  },
);

await withHarness(
  "resolved-library-forbidden-option",
  async (harness) => {
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    assert.equal(harness.compiler.calls, 0);
    assert.equal(existsSync(path.join(harness.root, "src-gen/index.ts")), false);
  },
  undefined,
  (options, root) => {
    const libraryHxml = path.join(root, "libraries/attacker.hxml");
    mkdirSync(path.dirname(libraryHxml), { recursive: true });
    writeFileSync(libraryHxml, "--next\n", "utf8");
    writeFileSync(
      path.join(root, "build.hxml"),
      "-cp src\n-lib attacker\n-main Main\n",
      "utf8",
    );
    return {
      ...options,
      hxml: {
        ...options.hxml,
        resolveLibrary: () => ({
          arguments: [libraryHxml],
          provenanceFiles: [libraryHxml],
        }),
      },
    };
  },
);

await withHarness(
  "hxml-post-compile-command-is-forbidden",
  async (harness) => {
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    assert.equal(harness.compiler.calls, 0);
    assert.equal(existsSync(path.join(harness.root, "command-ran.txt")), false);
  },
  undefined,
  (options, root) => {
    writeFileSync(
      path.join(root, "build.hxml"),
      "-cp src\n-main Main\n--cmd touch command-ran.txt\n",
      "utf8",
    );
    return options;
  },
);

await withHarness(
  "hxml-early-inline-option-stops-before-haxe",
  async (harness) => {
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    assert.equal(
      harness.compiler.calls,
      0,
      "a rejected inline --run spelling must never reach the compiler",
    );
  },
  undefined,
  (options, root) => {
    writeFileSync(path.join(root, "build.hxml"), "--run=Main\n", "utf8");
    return options;
  },
);

await withHarness(
  "input-output-portable-alias",
  async (harness) => {
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    assert.equal(harness.compiler.calls, 0);
  },
  undefined,
  (options, root) => {
    const aliasInput = path.join(root, "SRC-GEN/config.json");
    mkdirSync(path.dirname(aliasInput), { recursive: true });
    writeFileSync(aliasInput, "{}\n", "utf8");
    return {
      ...options,
      extraInputs: [
        { path: "SRC-GEN/config.json", impact: { rebuild: true } },
      ],
    };
  },
);

for (const field of ["generation", "revision", "acceptedAt", "sessionNonce"] as const) {
  await withHarness(`marker-drift-${field}`, async (harness) => {
    harness.compiler.steps.push(
      { content: "export const value = 1;\n" },
      { content: "export const value = 2;\n" },
    );
    await harness.session.start();
    await harness.session.waitForIdle();
    const layout = resolveSessionLayout(
      harness.root,
      `fixture-marker-drift-${field}`,
      "src-gen/index.ts",
      ".genes/dev",
    );
    const marker = path.join(
      harness.root,
      ...layout.generationMarkerRelative.split("/"),
    );
    const record = JSON.parse(readFileSync(marker, "utf8")) as Record<string, unknown>;
    record[field] =
      field === "sessionNonce" ? "external-rewrite" : Number(record[field]) + 1;
    const rewritten = `${JSON.stringify(record)}\n`;
    writeFileSync(marker, rewritten, "utf8");
    currentWatch(harness).change(harness.source);
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "degraded");
    assert.equal(readFileSync(marker, "utf8"), rewritten);
    assert.equal(harness.session.inspect().accepted?.generation, 1);
  });
}

await withHarness("manifest-byte-drift", async (harness) => {
  harness.compiler.steps.push(
    { content: "export const value = 1;\n" },
    { content: "export const value = 2;\n" },
  );
  await harness.session.start();
  await harness.session.waitForIdle();
  const manifest = path.join(harness.root, "src-gen", manifestName("index.ts"));
  const rewritten = readFileSync(manifest, "utf8").replaceAll("\n", "\r\n");
  writeFileSync(manifest, rewritten, "utf8");
  currentWatch(harness).change(harness.source);
  await harness.session.waitForIdle();
  assert.equal(harness.session.state.kind, "degraded");
  assert.equal(readFileSync(manifest, "utf8"), rewritten);
});

if (process.platform !== "win32") {
  await withHarness("manifest-mode-drift", async (harness) => {
    harness.compiler.steps.push(
      { content: "export const value = 1;\n" },
      { content: "export const value = 2;\n" },
    );
    await harness.session.start();
    await harness.session.waitForIdle();
    const manifest = path.join(harness.root, "src-gen", manifestName("index.ts"));
    chmodSync(manifest, 0o600);
    currentWatch(harness).change(harness.source);
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "degraded");
    assert.equal(statSync(manifest).mode & 0o777, 0o600);
  });
}

for (const failInsideGate of [false, true]) {
  await withHarness(
    `reconcile-failure-${failInsideGate ? "inside" : "before"}-gate`,
    async (harness) => {
      harness.compiler.steps.push(
        { content: "export const value = 1;\n" },
        { content: "export const value = 2;\n" },
      );
      await harness.session.start();
      await harness.session.waitForIdle();
      const watch = currentWatch(harness);
      if (failInsideGate) {
        watch.reconciliationResults.push(
          Object.freeze({ ok: true, changed: false }),
        );
      }
      watch.reconciliationResults.push(
        Object.freeze({
          ok: false,
          error: new Error("authoritative scan unavailable"),
        }),
      );
      currentWatch(harness).change(harness.source);
      await harness.session.waitForIdle();
      assert.equal(harness.session.state.kind, "degraded");
      assert.equal(
        readFileSync(path.join(harness.root, "src-gen/index.ts"), "utf8"),
        "export const value = 1;\n",
      );
      assert.equal(harness.session.inspect().accepted?.generation, 1);
    },
  );
}

await withHarness("reconcile-discovers-newer-revision", async (harness) => {
  harness.compiler.steps.push(
    { content: "export const stale = true;\n" },
    { content: "export const latest = true;\n" },
  );
  const starting = harness.session.start();
  while (harness.watches.length === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  currentWatch(harness).reconciliationChanges.push(harness.source);
  await starting;
  await harness.session.waitForIdle();
  assert.equal(harness.session.inspect().newestRevision, 2);
  assert.equal(harness.session.inspect().accepted?.revision, 2);
  assert.equal(
    readFileSync(path.join(harness.root, "src-gen/index.ts"), "utf8"),
    "export const latest = true;\n",
  );
  assert.equal(
    harness.events.filter((event) => event.event.kind === "candidate-superseded").length,
    1,
  );
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
    "-cp src\n-main Main\n-D changed-identity\n",
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

{
  const environmentKey = "GENES_SESSION_AMBIENT_IDENTITY_TEST";
  const previous = process.env[environmentKey];
  process.env[environmentKey] = "first";
  try {
    await withHarness("ambient-environment-rotation", async (harness) => {
      harness.compiler.steps.push(
        { content: "export const value = 1;\n" },
        { content: "export const value = 2;\n" },
      );
      await harness.session.start();
      await harness.session.waitForIdle();
      process.env[environmentKey] = "second";
      writeFileSync(
        harness.source,
        "class Main { static function main() {} }\n",
        "utf8",
      );
      currentWatch(harness).change(harness.source);
      await harness.session.waitForIdle();
      assert.equal(
        harness.compiler.invocations[0]!.environment[environmentKey],
        "first",
      );
      assert.equal(
        harness.compiler.invocations[1]!.environment[environmentKey],
        "second",
      );
      assert.notEqual(
        harness.compiler.compatibilityDigests[0],
        harness.compiler.compatibilityDigests[1],
        "a changed ambient Haxe environment must change server compatibility",
      );
    });
  } finally {
    if (previous === undefined) delete process.env[environmentKey];
    else process.env[environmentKey] = previous;
  }
}

await withHarness(
  "invocation-environment-owns-hxml-expansion",
  async (harness) => {
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "ready");
    const treeInputs = currentWatch(harness).options.inputs.filter(
      (input) => input.kind === "tree",
    );
    assert.equal(
      treeInputs.some((input) => input.path === path.join(harness.root, "src-b")),
      true,
    );
    assert.equal(
      treeInputs.some((input) => input.path === path.join(harness.root, "src-a")),
      false,
    );
  },
  undefined,
  (options, root) => {
    mkdirSync(path.join(root, "src-a"));
    mkdirSync(path.join(root, "src-b"));
    writeFileSync(
      path.join(root, "build.hxml"),
      "-cp %SRC_DIR%\n-main Main\n",
      "utf8",
    );
    return {
      ...options,
      resolveInvocation: () => ({
        executable: "haxe",
        cwd: root,
        args: ["build.hxml"],
        env: { SRC_DIR: "src-b" },
        ioPolicy: "haxe-4.3.7-development-js-v1",
        compatibilityFacts: { fixture: "invocation-environment" },
      }),
    };
  },
);

await withHarness(
  "resolved-library-class-path-is-watched",
  async (harness) => {
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "ready");
    assert.equal(
      currentWatch(harness).options.inputs.some(
        (input) =>
          input.kind === "tree" &&
          input.path === path.join(harness.root, "libraries", "sample", "src"),
      ),
      true,
    );
    assert.equal(
      currentWatch(harness).options.inputs.some(
        (input) =>
          input.kind === "exact" &&
          input.path === path.join(harness.root, "libraries", "sample.hxml"),
      ),
      true,
    );
    const executed = harness.compiler.invocations[0]!.arguments;
    assert.equal(executed.includes("-lib"), false);
    assert.equal(executed.includes("sample"), false);
    assert.equal(
      executed.includes(path.join(harness.root, "libraries", "sample", "src")),
      true,
    );
  },
  undefined,
  (options, root) => {
    const librarySource = path.join(root, "libraries", "sample", "src");
    mkdirSync(librarySource, { recursive: true });
    const libraryProvenance = path.join(root, "libraries", "sample.hxml");
    writeFileSync(libraryProvenance, `-cp ${librarySource}\n`, "utf8");
    writeFileSync(
      path.join(root, "build.hxml"),
      "-cp src\n-lib sample\n-main Main\n",
      "utf8",
    );
    return {
      ...options,
      hxml: {
        ...options.hxml,
        resolveLibrary: (_request, context) => {
          assert.equal(context.environment("SESSION_LIBRARY"), "exact");
          return {
            arguments: ["-cp", librarySource],
            provenanceFiles: [libraryProvenance],
          };
        },
      },
      resolveInvocation: () => ({
        executable: "haxe",
        cwd: root,
        args: ["build.hxml"],
        env: { SESSION_LIBRARY: "exact" },
        ioPolicy: "haxe-4.3.7-development-js-v1",
        compatibilityFacts: { fixture: "library-source-root" },
      }),
    };
  },
);

await withHarness("reinventory-then-compile-failure", async (harness) => {
  harness.compiler.steps.push(
    { content: "export const value = 1;\n" },
    { fail: "Haxe source error after HXML refresh" },
  );
  await harness.session.start();
  await harness.session.waitForIdle();
  writeFileSync(
    path.join(harness.root, "build.hxml"),
    "-cp src\n-main Main\n-D refreshed\n",
    "utf8",
  );
  currentWatch(harness).change(path.join(harness.root, "build.hxml"));
  await harness.session.waitForIdle();
  assert.equal(harness.session.state.kind, "degraded");
  const failure = harness.events
    .filter((event) => event.event.kind === "failed")
    .at(-1);
  assert.equal(failure?.event.kind, "failed");
  if (failure?.event.kind === "failed") {
    assert.equal(failure.event.failure.phase, "compile");
    assert.equal(
      (failure.event.failure.diagnostic as { readonly code: string }).code,
      "HAXE_COMPILE_FAILED",
    );
  }
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
          "-cp src-next\n-main Main\n",
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
    "-cp .genes/dev/authored\n-main Main\n",
    "utf8",
  );
  await harness.session.start();
  assert.equal(harness.session.state.kind, "blocked");
  if (harness.session.state.kind === "blocked") {
    assert.equal(harness.session.state.failure.phase, "inventory");
    assert.equal(harness.session.state.failure.recoverable, false);
    assert.match(
      String(harness.session.state.failure.diagnostic.message),
      /overlaps state, stable session-control files, or generated output/u,
    );
  }
  await assert.rejects(harness.session.firstAccepted, /fatal session failure/u);
  assert.throws(
    () =>
      harness.session.invalidate({
        path: "src/Main.hx",
        impact: { rebuild: true },
      }),
    /startup has not completed|cannot recover/u,
  );
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
  const recoveryEntered = deferred<void>();
  const releaseRecovery = deferred<void>();
  const harness = makeHarness("startup-invalidation", (dependencies) => ({
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
    assert.throws(
      () =>
        harness.session.invalidate({
          path: "src/Main.hx",
          impact: { rebuild: true },
        }),
      /startup has not completed/u,
    );
    assert.equal(harness.compiler.calls, 0);
    assert.equal(harness.session.inspect().newestRevision, 0);
    releaseRecovery.resolve();
    await starting;
    await harness.session.waitForIdle();
    assert.deepEqual(
      harness.events
        .filter((event) => event.event.kind === "build-started")
        .map((event) =>
          event.event.kind === "build-started" ? event.event.revision : -1,
        ),
      [1],
    );
    harness.session.invalidate({
      path: "src/Main.hx",
      impact: { rebuild: true },
    });
    await harness.session.waitForIdle();
    assert.equal(harness.session.inspect().newestRevision, 2);
  } finally {
    await harness.session.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
}

{
  let resolverSignal: AbortSignal | null = null;
  let rejectResolver!: (error: Error) => void;
  const resolverNever = new Promise<never>((_resolve, reject) => {
    rejectResolver = reject;
  });
  const harness = makeHarness(
    "abort-library-resolution",
    undefined,
    (options, root) => {
      writeFileSync(
        path.join(root, "build.hxml"),
        "-cp src\n-lib held\n-main Main\n",
        "utf8",
      );
      return {
        ...options,
        hxml: {
          ...options.hxml,
          resolveLibrary: (_request, context) => {
            resolverSignal = context?.signal ?? null;
            return resolverNever;
          },
        },
      };
    },
  );
  try {
    const starting = harness.session.start();
    while (resolverSignal === null) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const closing = harness.session.close();
    await Promise.race([
      closing,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("close waited for library resolver")), 500),
      ),
    ]);
    await starting;
    assert.equal((resolverSignal as unknown as AbortSignal).aborted, true);
    assert.equal(harness.compiler.calls, 0);
    assert.equal(harness.watches.length, 0);
    let lateUnhandled: unknown = null;
    const onUnhandled = (error: unknown): void => {
      lateUnhandled = error;
    };
    process.once("unhandledRejection", onUnhandled);
    rejectResolver(new Error("late resolver rejection"));
    await new Promise((resolve) => setImmediate(resolve));
    process.removeListener("unhandledRejection", onUnhandled);
    assert.equal(lateUnhandled, null);
    assert.equal(harness.compiler.calls, 0);
  } finally {
    await harness.session.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
}

{
  const harness = makeHarness("close-reentrant");
  let recursiveClose: Promise<void> | null = null;
  let closingEvents = 0;
  harness.session.subscribe((event) => {
    if (event.event.kind === "state" && event.event.state.kind === "closing") {
      closingEvents += 1;
      recursiveClose = harness.session.close();
    }
  });
  try {
    await harness.session.start();
    await harness.session.waitForIdle();
    const closing = harness.session.close();
    assert.equal(recursiveClose, closing);
    assert.equal(harness.session.close(), closing);
    await closing;
    assert.equal(closingEvents, 1);
    assert.equal(harness.compiler.closed, 1);
  } finally {
    await harness.session.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
}

for (const stopAt of [
  "inputs-changed",
  "building",
  "build-started",
  "candidate-generated",
] as const) {
  const harness = makeHarness(`close-from-${stopAt}`);
  let closing: Promise<void> | null = null;
  harness.session.subscribe((event) => {
    const matchesEvent =
      (stopAt === "building" &&
        event.event.kind === "state" &&
        event.event.state.kind === "building") ||
      event.event.kind === stopAt;
    if (matchesEvent && closing === null) closing = harness.session.close();
  });
  try {
    await harness.session.start();
    await (closing ?? harness.session.close());
    assert.equal(harness.session.state.kind, "closed");
    assert.equal(existsSync(path.join(harness.root, "src-gen/index.ts")), false);
    assert.equal(
      harness.events.some((event) => event.event.kind === "generation-accepted"),
      false,
    );
  } finally {
    await harness.session.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
}

{
  const harness = makeHarness("close-from-ready");
  let closing: Promise<void> | null = null;
  harness.session.subscribe((event) => {
    if (
      event.event.kind === "state" &&
      event.event.state.kind === "ready" &&
      closing === null
    ) {
      closing = harness.session.close();
    }
  });
  try {
    await harness.session.start();
    await (closing ?? harness.session.close());
    await assert.rejects(harness.session.firstAccepted, /closed before/u);
    assert.equal(harness.session.state.kind, "closed");
    assert.equal(
      harness.events.some((event) => event.event.kind === "generation-accepted"),
      false,
      "closing from the ready observer must stop the later acceptance event",
    );
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
    mkdtempSync(path.join(os.tmpdir(), "genes-session-project-writer-")),
  );
  const first = resolveSessionLayout(
    root,
    "fixture-project-writer",
    "first-output/index.ts",
    ".genes/first-state",
  );
  const second = resolveSessionLayout(
    root,
    "fixture-project-writer",
    "second-output/index.ts",
    ".genes/second-state",
  );
  let competing: ReturnType<typeof acquireSessionLock> | null = null;
  const owner = acquireSessionLock(first);
  try {
    try {
      competing = acquireSessionLock(second);
      assert.fail("a second project session unexpectedly acquired its lock");
    } catch (error) {
      assert.match(
        String(error),
        /another development session already owns this project/u,
        "different output folders must not publish shared supplemental files at the same time",
      );
    }
  } finally {
    if (competing !== null) competing.release();
    owner.release();
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-legacy-writer-")),
  );
  try {
    const layout = resolveSessionLayout(
      root,
      "fixture-legacy-writer",
      "src-gen/index.ts",
      ".genes/state",
    );
    const legacyLock = path.join(
      root,
      ...legacyControlPaths(layout).lock.split("/"),
    );
    mkdirSync(path.dirname(legacyLock), { recursive: true });
    writeFileSync(
      legacyLock,
      `${canonicalJson({
        protocol: "genes.tooling.development-session-lock.v1",
        projectIdentity: "fixture-legacy-writer",
        outputIdentity: layout.publicEntryAuthority,
        hostIdentity: createHash("sha256")
          .update(`genes.tooling.host\0${os.hostname()}`)
          .digest("hex"),
        pid: process.pid,
        nonce: "legacy-writer",
      } as CanonicalJson)}\n`,
      "utf8",
    );
    assert.throws(
      () => acquireSessionLock(layout),
      /another development session already owns this output/u,
      "an old entry-scoped session must block the upgraded root-scoped session",
    );
    assert.equal(
      existsSync(path.join(root, ...layout.sessionLockRelative.split("/"))),
      false,
      "a rejected upgrade must release the new root-scoped lock",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-alias-authority-")),
  );
  try {
    const lower = resolveSessionLayout(
      root,
      "fixture-alias-authority",
      "src-gen/index.ts",
      ".genes/state-a",
    );
    const upper = resolveSessionLayout(
      root,
      "fixture-alias-authority",
      "SRC-GEN/index.ts",
      ".genes/state-b",
    );
    assert.equal(lower.sessionLockRelative, upper.sessionLockRelative);
    assert.equal(lower.transactionRelative, upper.transactionRelative);
    assert.equal(lower.generationMarkerRelative, upper.generationMarkerRelative);
    assert.equal(sessionProjectDigest(lower), sessionProjectDigest(upper));
    assert.equal(
      admissionDigest(lower, "a".repeat(64), { fixture: "alias" }),
      admissionDigest(upper, "a".repeat(64), { fixture: "alias" }),
    );

    const lock = acquireSessionLock(lower);
    try {
      assert.throws(() => acquireSessionLock(upper), /already owns/u);
    } finally {
      lock.release();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-root-owner-")),
  );
  try {
    const first = resolveSessionLayout(
      root,
      "fixture-root-owner",
      "src-gen/index.ts",
      ".genes/state-a",
    );
    const second = resolveSessionLayout(
      root,
      "fixture-root-owner",
      "src-gen/other.ts",
      ".genes/state-b",
    );
    assert.equal(first.sessionLockRelative, second.sessionLockRelative);
    assert.equal(first.transactionRelative, second.transactionRelative);
    assert.notEqual(
      admissionDigest(first, "a".repeat(64), { fixture: "root-owner" }),
      admissionDigest(second, "a".repeat(64), { fixture: "root-owner" }),
    );
    const lock = acquireSessionLock(first);
    try {
      claimSessionRootOwner(first);
      assert.throws(() => acquireSessionLock(second), /already owns/u);
    } finally {
      lock.release();
    }
    mkdirSync(path.join(root, "src-gen"), { recursive: true });
    const competing = acquireSessionLock(second);
    try {
      assert.throws(
        () => claimSessionRootOwner(second),
        /already bound to a different development-session entry/u,
        "an existing public root still keeps one entry owner after the first session exits",
      );
    } finally {
      competing.release();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const corruption of ["truncated", "noncanonical", "symlink"] as const) {
  if (corruption === "symlink" && process.platform === "win32") continue;
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), `genes-session-root-owner-${corruption}-`)),
  );
  try {
    const layout = resolveSessionLayout(
      root,
      `fixture-root-owner-${corruption}`,
      "src-gen/index.ts",
      ".genes/state",
    );
    const initial = acquireSessionLock(layout);
    claimSessionRootOwner(layout);
    initial.release();
    const owner = path.join(root, ...layout.rootOwnerRelative.split("/"));
    if (corruption === "truncated") {
      writeFileSync(owner, '{"protocol":', "utf8");
    } else if (corruption === "noncanonical") {
      const decoded: unknown = JSON.parse(readFileSync(owner, "utf8"));
      writeFileSync(owner, `${JSON.stringify(decoded, null, 2)}\n`, "utf8");
    } else {
      const target = path.join(root, "owner-target.json");
      writeFileSync(target, readFileSync(owner));
      rmSync(owner, { force: true });
      symlinkSync(target, owner);
    }
    const lock = acquireSessionLock(layout);
    try {
      assert.throws(
        () => claimSessionRootOwner(layout),
        /root owner is invalid|root owner is a symbolic link|already bound to a different/u,
      );
    } finally {
      lock.release();
    }
    assert.equal(
      existsSync(path.join(root, ...layout.sessionLockRelative.split("/"))),
      false,
      "a rejected owner must release the temporary lifetime lock",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-root-owner-torn-write-")),
  );
  try {
    const layout = resolveSessionLayout(
      root,
      "fixture-root-owner-torn-write",
      "src-gen/index.ts",
      ".genes/state",
    );
    const initial = acquireSessionLock(layout);
    claimSessionRootOwner(layout);
    initial.release();
    const owner = path.join(root, ...layout.rootOwnerRelative.split("/"));
    const complete = readFileSync(owner, "utf8");
    writeFileSync(owner, complete.slice(0, Math.floor(complete.length / 2)), "utf8");
    writeFileSync(`${owner}.next`, "unfinished private bytes", "utf8");

    const recovered = acquireSessionLock(layout);
    assert.throws(
      () => claimSessionRootOwner(layout),
      /root owner is invalid/u,
      "a torn final owner fails closed instead of being repaired from absence alone",
    );
    recovered.release();
    assert.equal(
      existsSync(`${owner}.next`),
      false,
      "a restart removes only the uncommitted private owner file",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await withHarness(
  "root-v2-admission-recovery",
  async (harness) => {
    harness.compiler.steps.push({ content: "export const current = true;\n" });
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(
      harness.session.state.kind,
      "ready",
      `a valid root-owned publication saved before supplemental files were added must survive an upgrade restart: ${JSON.stringify(harness.session.state)}`,
    );
    assert.equal((await harness.session.firstAccepted).generation, 1);
  },
  (dependencies, root) => {
    const layout = resolveSessionLayout(
      root,
      "fixture-root-v2-admission-recovery",
      "src-gen/index.ts",
      ".genes/dev",
    );
    const setupLock = acquireSessionLock(layout);
    try {
      claimSessionRootOwner(layout);
    } finally {
      setupLock.release();
    }
    mkdirSync(layout.publicOutputRoot, { recursive: true });
    writeFileSync(
      layout.publicOutputFile,
      "export const legacy = true;\n",
      "utf8",
    );
    writeFileSync(
      path.join(layout.publicOutputRoot, manifestName(layout.outputIdentity)),
      `genes-output-manifest-v2\nowner-base64:${Buffer.from(layout.outputIdentity).toString("base64")}\n${layout.outputIdentity}\n`,
      "utf8",
    );
    const live = readGenesOutput(
      layout.publicOutputRoot,
      layout.outputIdentity,
      true,
    )!;
    const marker = `${canonicalJson({
      protocol: "genes.tooling.accepted-generation.v2",
      sessionNonce: "root-v2-session",
      generation: 4,
      revision: 7,
      acceptedAt: 999_999,
      manifestDigest: live.manifestDigest,
      publicOutputRoot: layout.publicOutputRootAuthority,
      publicOutputRootPath: layout.publicOutputRootRelative ?? ".",
      publicEntry: layout.publicEntryAuthority,
      publicEntryPath: layout.publicOutputRelative,
    })}\n`;
    const markerPath = path.join(
      root,
      ...layout.generationMarkerRelative.split("/"),
    );
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, marker, { mode: 0o600 });
    const rootV2Authorization = canonicalDigest({
      protocol: "genes.tooling.development-session-admission.v2",
      projectIdentity: sessionProjectDigest(layout),
      publicOutputRoot: layout.publicOutputRootAuthority,
      publicEntry: layout.publicEntryAuthority,
      manifestDigest: live.manifestDigest,
      validatorPolicyFacts: { policy: "fixture" },
    } as CanonicalJson);
    const absent = Object.freeze({ kind: "absent" as const });
    const plan: PublicationPlan = Object.freeze({
      protocol: ARTIFACT_PLAN_PROTOCOL,
      version: ARTIFACT_PLAN_VERSION,
      projectIdentity: sessionProjectDigest(layout),
      authorizationDigest: rootV2Authorization,
      transactionRoot: layout.transactionRelative,
      stageRoot: `${layout.candidatesRelative}/root-v2-recovery`,
      artifacts: Object.freeze([]),
      commitMarker: Object.freeze({
        path: layout.generationMarkerRelative,
        prior: absent,
        next: absent,
        stagedPath: null,
      }),
    });
    return {
      ...dependencies,
      recover: async (options) => {
        if (options.transactionRoot === layout.legacyTransactionRelative) {
          return { action: "none", transactionId: null };
        }
        assert.equal(
          await options.admitIntended(plan),
          true,
          "recovery must use the v2 digest shape recorded by the saved marker",
        );
        return { action: "committed", transactionId: "a".repeat(64) };
      },
    };
  },
  (options) => ({
    ...options,
    validate: async (_tree, context) =>
      context.recovery
        ? {
            ok: true,
            artifacts: [
              {
                path: "new-validator/receipt.json",
                content: "{\"new\":true}\n",
              },
            ],
          }
        : { ok: true },
  }),
);

await withHarness(
  "root-v3-admission-recovery",
  async (harness) => {
    harness.compiler.steps.push({ content: "export const current = true;\n" });
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(
      harness.session.state.kind,
      "ready",
      `a saved version-3 publication must remain readable after the marker format grows: ${JSON.stringify(harness.session.state)}`,
    );
  },
  (dependencies, root) => {
    const layout = resolveSessionLayout(
      root,
      "fixture-root-v3-admission-recovery",
      "src-gen/index.ts",
      ".genes/dev",
    );
    const setupLock = acquireSessionLock(layout);
    try {
      claimSessionRootOwner(layout);
    } finally {
      setupLock.release();
    }
    const live = seedOwnedOutput(layout, "export const recovered = true;\n");
    const receiptPath = "generated-evidence/legacy-receipt.json";
    const receiptBytes = "{\"legacy\":true}\n";
    const receiptAbsolute = path.join(root, ...receiptPath.split("/"));
    mkdirSync(path.dirname(receiptAbsolute), { recursive: true });
    writeFileSync(receiptAbsolute, receiptBytes, { mode: 0o644 });
    const legacySupplemental = [
      {
        path: receiptPath,
        sha256: sha256Bytes(receiptBytes),
        sizeBytes: Buffer.byteLength(receiptBytes),
        mode: 0o644,
      },
    ] as const;
    const marker = `${canonicalJson({
      protocol: "genes.tooling.accepted-generation.v3",
      sessionNonce: "root-v3-session",
      generation: 4,
      revision: 7,
      acceptedAt: 999_999,
      manifestDigest: live.manifestDigest,
      publicOutputRoot: layout.publicOutputRootAuthority,
      publicOutputRootPath: layout.publicOutputRootRelative ?? ".",
      publicEntry: layout.publicEntryAuthority,
      publicEntryPath: layout.publicOutputRelative,
      supplementalFiles: legacySupplemental,
    } as CanonicalJson)}\n`;
    const markerPath = path.join(
      root,
      ...layout.generationMarkerRelative.split("/"),
    );
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, marker, { mode: 0o600 });
    const plan: PublicationPlan = Object.freeze({
      protocol: ARTIFACT_PLAN_PROTOCOL,
      version: ARTIFACT_PLAN_VERSION,
      projectIdentity: sessionProjectDigest(layout),
      authorizationDigest: canonicalDigest({
        protocol: "genes.tooling.development-session-admission.v3",
        projectIdentity: sessionProjectDigest(layout),
        publicOutputRoot: layout.publicOutputRootAuthority,
        publicEntry: layout.publicEntryAuthority,
        manifestDigest: live.manifestDigest,
        supplementalFiles: legacySupplemental,
        validatorPolicyFacts: { policy: "fixture" },
      } as CanonicalJson),
      transactionRoot: layout.transactionRelative,
      stageRoot: `${layout.candidatesRelative}/root-v3-recovery`,
      artifacts: Object.freeze([]),
      commitMarker: Object.freeze({
        path: layout.generationMarkerRelative,
        prior: Object.freeze({ kind: "absent" as const }),
        next: Object.freeze({ kind: "absent" as const }),
        stagedPath: null,
      }),
    });
    return {
      ...dependencies,
      recover: async (options) => {
        if (options.transactionRoot === layout.legacyTransactionRelative) {
          return { action: "none", transactionId: null };
        }
        assert.equal(
          await options.admitIntended(plan),
          true,
          "recovery must accept the exact admission digest written by the older version-3 format",
        );
        return { action: "committed", transactionId: "c".repeat(64) };
      },
    };
  },
  (options) => ({
    ...options,
    validate: async (_tree, context) =>
      context.recovery
        ? {
            ok: true,
            artifacts: [
              {
                path: "generated-evidence/legacy-receipt.json",
                content: "{\"legacy\":true}\n",
              },
              {
                path: "generated-evidence/new-receipt.json",
                content: "{\"new\":true}\n",
              },
            ],
          }
        : { ok: true },
  }),
);

{
  let recoveryChecked = false;
  await withHarness(
    "recovery-rejects-changed-validator-artifact",
    async (harness) => {
      harness.compiler.steps.push({ content: "export const current = true;\n" });
      await harness.session.start();
      await harness.session.waitForIdle();
      assert.equal(
        recoveryChecked,
        true,
        "restart must ask the host to check the intended recovered files",
      );
      assert.equal(
        harness.session.state.kind,
        "ready",
        `a stale recovered receipt must be refused before the new revision builds: ${JSON.stringify(harness.session.state)}`,
      );
    },
    (dependencies, root) => {
      const layout = resolveSessionLayout(
        root,
        "fixture-recovery-rejects-changed-validator-artifact",
        "src-gen/index.ts",
        ".genes/dev",
      );
      const setupLock = acquireSessionLock(layout);
      try {
        claimSessionRootOwner(layout);
      } finally {
        setupLock.release();
      }
      const live = seedOwnedOutput(layout, "export const recovered = true;\n");
      const receiptPath = "generated-haxe/host-receipt.json";
      const receiptBytes = "{\"accepted\":1}\n";
      const receiptAbsolute = path.join(root, ...receiptPath.split("/"));
      mkdirSync(path.dirname(receiptAbsolute), { recursive: true });
      writeFileSync(receiptAbsolute, receiptBytes, { mode: 0o644 });
      const supplemental = Object.freeze([
        Object.freeze({
          source: "validator" as const,
          path: receiptPath,
          sha256: sha256Bytes(receiptBytes),
          sizeBytes: Buffer.byteLength(receiptBytes),
          mode: 0o644,
        }),
      ]);
      const marker = acceptedGenerationBytes(
        layout,
        {
          sessionNonce: "recovered-receipt",
          generation: 2,
          revision: 3,
          acceptedAt: 999_999,
          manifestDigest: live.manifestDigest,
        },
        supplemental,
      );
      const markerPath = path.join(
        root,
        ...layout.generationMarkerRelative.split("/"),
      );
      mkdirSync(path.dirname(markerPath), { recursive: true });
      writeFileSync(markerPath, marker, { mode: 0o600 });
      const plan: PublicationPlan = Object.freeze({
        protocol: ARTIFACT_PLAN_PROTOCOL,
        version: ARTIFACT_PLAN_VERSION,
        projectIdentity: sessionProjectDigest(layout),
        authorizationDigest: admissionDigest(
          layout,
          live.manifestDigest,
          { policy: "fixture" },
          supplemental,
        ),
        transactionRoot: layout.transactionRelative,
        stageRoot: `${layout.candidatesRelative}/recovered-receipt`,
        artifacts: Object.freeze([]),
        commitMarker: Object.freeze({
          path: layout.generationMarkerRelative,
          prior: Object.freeze({ kind: "absent" as const }),
          next: Object.freeze({ kind: "absent" as const }),
          stagedPath: null,
        }),
      });
      return {
        ...dependencies,
        recover: async (options) => {
          if (options.transactionRoot === layout.legacyTransactionRelative) {
            return { action: "none", transactionId: null };
          }
          recoveryChecked = true;
          assert.equal(
            await options.admitIntended(plan),
            false,
            "recovery must reject a validator receipt whose new bytes differ from the saved live receipt",
          );
          return { action: "rolled-back", transactionId: "b".repeat(64) };
        },
      };
    },
    (options) => ({
      ...options,
      validate: async (_tree, context) =>
        context.recovery
          ? {
              ok: true,
              artifacts: [
                {
                  path: "generated-haxe/host-receipt.json",
                  content: "{\"accepted\":2}\n",
                },
              ],
            }
          : { ok: true },
    }),
  );
}

assert.equal(
  recoveredArtifactsMatchPublishedFiles(
    [],
    [
      {
        source: "validator",
        path: "generated-evidence/receipt.json",
        sha256: "a".repeat(64),
        sizeBytes: 2,
        mode: 0o644,
      },
    ],
  ),
  false,
  "recovery must not keep a saved validator receipt when validation no longer returns it",
);
assert.equal(
  recoveredArtifactsMatchPublishedFiles(
    [],
    [
      {
        source: "prepared",
        path: "generated-haxe/FeatureFacts.hx",
        sha256: "b".repeat(64),
        sizeBytes: 2,
        mode: 0o644,
      },
    ],
  ),
  true,
  "recovery does not ask validation to reproduce a file owned by preparation",
);

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-control-output-")),
  );
  try {
    assert.throws(
      () =>
        resolveSessionLayout(
          root,
          "fixture-control-output",
          ".genes/tooling/session-locks/app.ts",
          ".genes/dev",
        ),
      /stable session-control/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-control-marker-")),
  );
  try {
    const layout = resolveSessionLayout(
      root,
      "fixture-control-marker",
      "src-gen/index.ts",
      ".genes/dev",
    );
    const markerPath = path.join(
      root,
      ...layout.generationMarkerRelative.split("/"),
    );
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(
      markerPath,
      `${canonicalJson({
        protocol: "genes.tooling.accepted-generation.v4",
        sessionNonce: "control-marker",
        generation: 1,
        revision: 1,
        acceptedAt: 1,
        manifestDigest: "a".repeat(64),
        publicOutputRoot: layout.publicOutputRootAuthority,
        publicOutputRootPath: layout.publicOutputRootRelative ?? ".",
        publicEntry: layout.publicEntryAuthority,
        publicEntryPath: layout.publicOutputRelative,
        supplementalFiles: [
          {
            source: "prepared",
            path: ".genes/tooling/session-locks/host.json",
            sha256: "b".repeat(64),
            sizeBytes: 2,
            mode: 0o600,
          },
        ],
      } as CanonicalJson)}\n`,
      "utf8",
    );
    assert.throws(
      () => readPublishedMarker(layout),
      /accepted supplemental file overlaps private state or stable session-control files/u,
      "a saved marker cannot turn a session control file into ordinary generated output",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await withHarness(
  "prepared-file-cannot-claim-session-controls",
  async (harness) => {
    harness.compiler.steps.push({ content: "export const value = 1;\n" });
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    assert.equal(harness.compiler.calls, 0);
    assert.equal(
      existsSync(
        path.join(harness.root, ".genes/tooling/session-locks/host.json"),
      ),
      false,
    );
  },
  undefined,
  (options) => ({
    ...options,
    prepareRevision: () => ({
      ok: true,
      prepared: {
        classPaths: ["haxe"],
        files: [
          {
            relativePath: "haxe/Prepared.hx",
            content: "class Prepared {}\n",
            publishPath: ".genes/tooling/session-locks/host.json",
          },
        ],
      },
    }),
  }),
);

await withHarness(
  "admitted-file-cannot-claim-sibling-session-controls",
  async (harness) => {
    harness.compiler.steps.push({ content: "export const value = 1;\n" });
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    assert.equal(
      existsSync(
        path.join(
          harness.root,
          ".genes/tooling/session-publications/sibling/receipt.json",
        ),
      ),
      false,
    );
  },
  undefined,
  (options) => ({
    ...options,
    validate: async () => ({
      ok: true,
      artifacts: [
        {
          path: ".genes/tooling/session-publications/sibling/receipt.json",
          content: "{}\n",
        },
      ],
    }),
  }),
);
for (const checkpoint of [
  "after-journal-prepared",
  "after-publish:src-gen/index.ts",
  "after-publish:commit-marker",
] as const) {
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-state-recovery-")),
  );
  try {
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src/Main.hx"), "class Main {}\n", "utf8");
    writeFileSync(
      path.join(root, "build.hxml"),
      "-cp src\n-main Main\n",
      "utf8",
    );
    const fixture = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "session-crash-fixture.js",
    );
    const crashed = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-a",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
        GENES_SESSION_CRASH_CONTENT: "export const fromA = true;\n",
        GENES_SESSION_CRASH_AT: checkpoint,
      },
      encoding: "utf8",
    });
    assert.equal(
      crashed.status,
      73,
      `session crash fixture failed at ${checkpoint}: ${crashed.stdout}\n${crashed.stderr}`,
    );
    const layoutA = resolveSessionLayout(
      root,
      "fixture-alternate-state-recovery",
      "src-gen/index.ts",
      ".genes/state-a",
    );
    const restartOutput = "src-gen/index.ts";
    const layoutB = resolveSessionLayout(
      root,
      "fixture-alternate-state-recovery",
      restartOutput,
      ".genes/state-b",
    );
    assert.equal(layoutA.transactionRelative, layoutB.transactionRelative);
    assert.equal(
      layoutA.generationMarkerRelative,
      layoutB.generationMarkerRelative,
    );
    assert.notEqual(layoutA.candidatesRelative, layoutB.candidatesRelative);
    assert.notEqual(layoutA.serverLeaseRelative, layoutB.serverLeaseRelative);

    const recovered = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-b",
        GENES_SESSION_CRASH_OUTPUT: restartOutput,
        GENES_SESSION_CRASH_CONTENT: "export const fromB = true;\n",
      },
      encoding: "utf8",
    });
    assert.equal(
      recovered.status,
      0,
      `alternate-state recovery failed at ${checkpoint}: ${recovered.stdout}\n${recovered.stderr}`,
    );
    assert.equal(
      readFileSync(path.join(root, ...restartOutput.split("/")), "utf8"),
      "export const fromB = true;\n",
    );
    const transactionRoot = path.join(
      root,
      ...layoutA.transactionRelative.split("/"),
    );
    assert.deepEqual(
      existsSync(transactionRoot) ? readdirSync(transactionRoot) : [],
      [],
      "alternate private state must recover and remove the original journal",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-legacy-recovery-")),
  );
  try {
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src/Main.hx"), "class Main {}\n", "utf8");
    writeFileSync(path.join(root, "build.hxml"), "-cp src\n-main Main\n", "utf8");
    const fixture = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "session-crash-fixture.js",
    );
    const crashed = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-a",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
        GENES_SESSION_CRASH_CONTENT: "export const legacy = true;\n",
        GENES_SESSION_CRASH_AT: "after-publish:commit-marker",
        GENES_SESSION_CRASH_LEGACY_AUTHORITY: "true",
      },
      encoding: "utf8",
    });
    assert.equal(crashed.status, 73, crashed.stderr);
    const layout = resolveSessionLayout(
      root,
      "fixture-alternate-state-recovery",
      "src-gen/index.ts",
      ".genes/state-b",
    );
    assert.equal(
      existsSync(
        path.join(root, ...layout.legacyGenerationMarkerRelative.split("/")),
      ),
      true,
    );
    assert.equal(
      existsSync(path.join(root, ...layout.generationMarkerRelative.split("/"))),
      false,
    );

    const recovered = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-b",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
        GENES_SESSION_CRASH_CONTENT: "export const current = true;\n",
      },
      encoding: "utf8",
    });
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(
      readFileSync(path.join(root, "src-gen/index.ts"), "utf8"),
      "export const current = true;\n",
    );
    assert.deepEqual(
      readdirSync(
        path.join(root, ...layout.legacyTransactionRelative.split("/")),
      ),
      [],
      "the upgraded session must finish and remove the old recovery journal",
    );
    assert.equal(
      existsSync(path.join(root, ...layout.generationMarkerRelative.split("/"))),
      true,
      "the accepted upgrade must establish root-scoped recovery state",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const checkpoint of [
  "during-receipt:after-journal-prepared",
  "during-receipt:after-publish:commit-marker",
  "after-receipt",
  "during-fence:after-journal-prepared",
  "during-fence:after-backup:commit-marker",
  "during-fence:after-publish:commit-marker",
  "after-fence",
  "during-owner:after-journal-prepared",
  "during-owner:after-publish:commit-marker",
  "after-owner",
  "during-root-marker:after-journal-prepared",
  "during-root-marker:after-publish:commit-marker",
  "after-root-marker",
] as const) {
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-migration-crash-")),
  );
  try {
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src/Main.hx"), "class Main {}\n", "utf8");
    writeFileSync(path.join(root, "build.hxml"), "-cp src\n-main Main\n", "utf8");
    const layout = resolveSessionLayout(
      root,
      "fixture-alternate-state-recovery",
      "src-gen/index.ts",
      ".genes/state-a",
    );
    const legacy = seedOwnedOutput(layout, "export const legacy = true;\n");
    writeLegacyMarker(layout, legacy.manifestDigest);
    const fixture = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "session-crash-fixture.js",
    );
    const crashed = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-a",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
        GENES_SESSION_MIGRATION_CRASH_AT: checkpoint,
      },
      encoding: "utf8",
    });
    assert.equal(
      crashed.status,
      74,
      `migration fixture did not stop at ${checkpoint}: ${crashed.stderr}`,
    );

    const restarted = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-b",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
        GENES_SESSION_CRASH_CONTENT: "export const current = true;\n",
      },
      encoding: "utf8",
    });
    assert.equal(
      restarted.status,
      0,
      `migration restart failed after ${checkpoint}: ${restarted.stderr}`,
    );
    assert.equal(
      readFileSync(path.join(root, "src-gen/index.ts"), "utf8"),
      "export const current = true;\n",
    );
    const fence = JSON.parse(
      readFileSync(
        path.join(root, ...layout.legacyGenerationMarkerRelative.split("/")),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.equal(
      fence.protocol,
      "genes.tooling.development-session-legacy-fence.v1",
    );
    assert.equal(
      existsSync(
        path.join(root, ...layout.authorityMigrationReceiptRelative.split("/")),
      ),
      true,
    );
    for (const step of ["receipt", "fence", "owner", "root-marker"] as const) {
      const transaction = path.join(
        root,
        ...`${layout.authorityMigrationRelative}/transactions/${step}`.split("/"),
      );
      assert.deepEqual(
        existsSync(transaction) ? readdirSync(transaction) : [],
        [],
        `restart must remove the ${step} migration journal after ${checkpoint}`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-alias-recovery-")),
  );
  try {
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src/Main.hx"), "class Main {}\n", "utf8");
    writeFileSync(
      path.join(root, "build.hxml"),
      "-cp src\n-main Main\n",
      "utf8",
    );
    const fixture = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "session-crash-fixture.js",
    );
    const crashed = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-a",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
        GENES_SESSION_CRASH_AT: "after-journal-prepared",
      },
      encoding: "utf8",
    });
    assert.equal(crashed.status, 73, crashed.stderr);
    const original = resolveSessionLayout(
      root,
      "fixture-alternate-state-recovery",
      "src-gen/index.ts",
      ".genes/state-a",
    );
    const alias = resolveSessionLayout(
      root,
      "fixture-alternate-state-recovery",
      "SRC-GEN/index.ts",
      ".genes/state-b",
    );
    assert.equal(original.transactionRelative, alias.transactionRelative);
    await recoverArtifacts({
      projectRoot: root,
      transactionRoot: alias.transactionRelative,
      projectIdentity: sessionProjectDigest(alias),
      admitIntended: async () => true,
    });
    const transactionRoot = path.join(
      root,
      ...original.transactionRelative.split("/"),
    );
    assert.deepEqual(
      existsSync(transactionRoot) ? readdirSync(transactionRoot) : [],
      [],
      "an alias restart must discover and resolve the original journal",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-root-owner-recovery-")),
  );
  try {
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src/Main.hx"), "class Main {}\n", "utf8");
    writeFileSync(path.join(root, "build.hxml"), "-cp src\n-main Main\n", "utf8");
    const fixture = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "session-crash-fixture.js",
    );
    const crashed = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-a",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
        GENES_SESSION_CRASH_AT: "after-journal-prepared",
      },
      encoding: "utf8",
    });
    assert.equal(crashed.status, 73, crashed.stderr);
    const competing = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-b",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/other.ts",
      },
      encoding: "utf8",
    });
    assert.notEqual(competing.status, 0);
    assert.match(competing.stderr, /already bound to a different/u);
    const ownerRestart = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-c",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
      },
      encoding: "utf8",
    });
    assert.equal(ownerRestart.status, 0, ownerRestart.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-foreign-recovery-")),
  );
  try {
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src/Main.hx"), "class Main {}\n", "utf8");
    writeFileSync(path.join(root, "build.hxml"), "-cp src\n-main Main\n", "utf8");
    const fixture = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "session-crash-fixture.js",
    );
    const baseline = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-a",
        GENES_SESSION_CRASH_OUTPUT: "first-output/index.ts",
        GENES_SESSION_CRASH_CONTENT: "export const baseline = true;\n",
      },
      encoding: "utf8",
    });
    assert.equal(baseline.status, 0, baseline.stderr);

    const crashed = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-b",
        GENES_SESSION_CRASH_OUTPUT: "first-output/index.ts",
        GENES_SESSION_CRASH_CONTENT: "export const recovered = true;\n",
        GENES_SESSION_CRASH_SUPPLEMENTAL_PATH: "shared/generated.txt",
        GENES_SESSION_CRASH_SUPPLEMENTAL_CONTENT: "first session\n",
        GENES_SESSION_CRASH_AT: "after-journal-prepared",
      },
      encoding: "utf8",
    });
    assert.equal(crashed.status, 73, crashed.stderr);

    const competing = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-c",
        GENES_SESSION_CRASH_OUTPUT: "second-output/index.ts",
        GENES_SESSION_CRASH_CONTENT: "export const competing = true;\n",
        GENES_SESSION_CRASH_SUPPLEMENTAL_PATH: "shared/generated.txt",
        GENES_SESSION_CRASH_SUPPLEMENTAL_CONTENT: "second session\n",
      },
      encoding: "utf8",
    });
    assert.notEqual(
      competing.status,
      0,
      "a different output folder must not publish while another folder has unfinished recovery work",
    );
    assert.match(
      competing.stderr,
      /unfinished update for another output folder/u,
    );
    assert.equal(
      existsSync(path.join(root, "shared/generated.txt")),
      false,
      "the competing session must not publish the shared file",
    );

    const recovered = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-d",
        GENES_SESSION_CRASH_OUTPUT: "first-output/index.ts",
        GENES_SESSION_CRASH_CONTENT: "export const recovered = true;\n",
        GENES_SESSION_CRASH_SUPPLEMENTAL_PATH: "shared/generated.txt",
        GENES_SESSION_CRASH_SUPPLEMENTAL_CONTENT: "first session\n",
      },
      encoding: "utf8",
    });
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(
      readFileSync(path.join(root, "shared/generated.txt"), "utf8"),
      "first session\n",
      "the original output folder can recover before another folder starts",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-recovery-input-")),
  );
  try {
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src/Main.hx"), "class Main {}\n", "utf8");
    writeFileSync(path.join(root, "build.hxml"), "-cp src\n-main Main\n", "utf8");
    const fixture = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "session-crash-fixture.js",
    );
    const generatedPath = "new-authored-root/GeneratedFacts.hx";
    const baseline = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-input-a",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
        GENES_SESSION_CRASH_CONTENT: "export const baseline = true;\n",
        GENES_SESSION_CRASH_SUPPLEMENTAL_PATH: generatedPath,
        GENES_SESSION_CRASH_SUPPLEMENTAL_CONTENT: "package new_authored_root;\n",
      },
      encoding: "utf8",
    });
    assert.equal(baseline.status, 0, baseline.stderr);

    const crashed = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-input-b",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
        GENES_SESSION_CRASH_CONTENT: "export const removed = true;\n",
        GENES_SESSION_CRASH_AT: `after-backup:${generatedPath}`,
      },
      encoding: "utf8",
    });
    assert.equal(crashed.status, 73, crashed.stderr);
    assert.equal(
      existsSync(path.join(root, ...generatedPath.split("/"))),
      false,
      "the interrupted update leaves the old generated file in its private backup",
    );

    const restart = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-input-c",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
        GENES_SESSION_CRASH_CONTENT: "export const restart = true;\n",
        GENES_SESSION_HXML_ON_WATCH:
          "-cp src\n-cp new-authored-root\n-main Main\n",
      },
      encoding: "utf8",
    });
    assert.notEqual(
      restart.status,
      0,
      "restart must stop when its input graph changes around recovery",
    );
    assert.match(
      restart.stderr,
      /overlaps an authored compiler input/u,
    );
    assert.equal(
      existsSync(path.join(root, ...generatedPath.split("/"))),
      false,
      "recovery must leave the newly authored input path untouched after the startup race",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-alias-restart-")),
  );
  try {
    const caseProbe = path.join(root, "case-probe");
    mkdirSync(caseProbe);
    const caseInsensitive = existsSync(path.join(root, "CASE-PROBE"));
    rmSync(caseProbe, { recursive: true, force: true });
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src/Main.hx"), "class Main {}\n", "utf8");
    writeFileSync(
      path.join(root, "build.hxml"),
      "-cp src\n-main Main\n",
      "utf8",
    );
    const fixture = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "session-crash-fixture.js",
    );
    const first = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: {
        ...process.env,
        GENES_SESSION_CRASH_ROOT: root,
        GENES_SESSION_CRASH_STATE: ".genes/state-a",
        GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
        GENES_SESSION_CRASH_CONTENT: "export const baseline = true;\n",
      },
      encoding: "utf8",
    });
    assert.equal(first.status, 0, first.stderr);
    if (caseInsensitive) {
      const crashed = spawnSync(process.execPath, [fixture], {
        cwd: root,
        env: {
          ...process.env,
          GENES_SESSION_CRASH_ROOT: root,
          GENES_SESSION_CRASH_STATE: ".genes/state-b",
          GENES_SESSION_CRASH_OUTPUT: "src-gen/index.ts",
          GENES_SESSION_CRASH_CONTENT: "export const interrupted = true;\n",
          GENES_SESSION_CRASH_AT: "after-journal-prepared",
        },
        encoding: "utf8",
      });
      assert.equal(crashed.status, 73, crashed.stderr);
      const alias = spawnSync(process.execPath, [fixture], {
        cwd: root,
        env: {
          ...process.env,
          GENES_SESSION_CRASH_ROOT: root,
          GENES_SESSION_CRASH_STATE: ".genes/state-c",
          GENES_SESSION_CRASH_OUTPUT: "SRC-GEN/index.ts",
          GENES_SESSION_CRASH_CONTENT: "export const alias = true;\n",
        },
        encoding: "utf8",
      });
      assert.equal(alias.status, 0, alias.stderr);
      assert.equal(
        readFileSync(path.join(root, "src-gen/index.ts"), "utf8"),
        "export const alias = true;\n",
        "an alias restart may recover when both spellings name the same real output",
      );
    } else {
      // Keep the output folder unchanged here. This branch checks the entry
      // file spelling; changing the folder too would correctly fail at the
      // earlier folder-ownership check and hide the behavior under test.
      const alias = spawnSync(process.execPath, [fixture], {
        cwd: root,
        env: {
          ...process.env,
          GENES_SESSION_CRASH_ROOT: root,
          GENES_SESSION_CRASH_STATE: ".genes/state-b",
          GENES_SESSION_CRASH_OUTPUT: "src-gen/INDEX.ts",
        },
        encoding: "utf8",
      });
      assert.notEqual(alias.status, 0);
      assert.match(alias.stderr, /use that original public output path/u);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.platform !== "win32") {
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-symlink-identity-")),
  );
  try {
    const realDirectory = path.join(root, "real-directory");
    const alias = path.join(root, "alias-directory");
    mkdirSync(realDirectory);
    symlinkSync(realDirectory, alias);
    assert.equal(
      samePhysicalSessionPath(realDirectory, alias, "directory"),
      false,
      "a symbolic link cannot prove that two path spellings are a native case alias",
    );
    const realFile = path.join(root, "real-file.ts");
    const fileAlias = path.join(root, "alias-file.ts");
    writeFileSync(realFile, "// real\n", "utf8");
    symlinkSync(realFile, fileAlias);
    assert.equal(
      samePhysicalSessionPath(realFile, fileAlias, "file"),
      false,
      "a symbolic link cannot prove that two entry spellings are a native case alias",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.platform !== "win32") {
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-symlink-case-probe-")),
  );
  try {
    const realProbe = path.join(root, "case-probe");
    mkdirSync(realProbe);
    const caseInsensitive = existsSync(path.join(root, "CASE-PROBE"));
    rmSync(realProbe, { recursive: true, force: true });
    if (!caseInsensitive) {
      const lower = resolveSessionLayout(
        root,
        "fixture-symlink-case-probe",
        "src-gen/index.ts",
        ".genes/state-a",
      );
      mkdirSync(path.join(root, "src-gen"));
      writeFileSync(path.join(root, "src-gen/index.ts"), "// lower\n", "utf8");
      const first = acquireSessionLock(lower);
      claimSessionRootOwner(lower);
      first.release();

      // On a case-sensitive filesystem these are two different output roots.
      // A `.GENES` symlink must not make the second spelling look like a safe
      // case-only alias of the first root.
      symlinkSync(path.join(root, ".genes"), path.join(root, ".GENES"));
      mkdirSync(path.join(root, "SRC-GEN"));
      writeFileSync(path.join(root, "SRC-GEN/index.ts"), "// upper\n", "utf8");
      const upper = resolveSessionLayout(
        root,
        "fixture-symlink-case-probe",
        "SRC-GEN/index.ts",
        ".genes/state-b",
      );
      const upperLock = acquireSessionLock(upper);
      try {
        assert.throws(
          () => claimSessionRootOwner(upper),
          /already bound to a different development-session entry/u,
        );
      } finally {
        upperLock.release();
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
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
          "invalid-portable-alias-overlap",
          "src-gen/index.ts",
          "SRC-GEN/.genes",
        ),
      /must not overlap/u,
      "portable aliases of the generated tree must not contain private state",
    );
    for (const stateDirectory of [
      ".genes",
      ".genes/tooling",
      ".GENES/TOOLING/private",
    ] as const) {
      assert.throws(
        () =>
          resolveSessionLayout(
            root,
            `invalid-control-overlap-${stateDirectory}`,
            "src-gen/index.ts",
            stateDirectory,
          ),
        /stable session-control directory must not overlap/u,
        "caller-selected private state must not contain stable locks or recovery authority",
      );
    }
    for (const publicOutput of [
      "index.ts",
      ".genes/index.ts",
      ".genes/tooling/generated/index.ts",
      ".GENES/TOOLING/generated/index.ts",
    ] as const) {
      assert.throws(
        () =>
          resolveSessionLayout(
            root,
            `invalid-public-control-overlap-${publicOutput}`,
            publicOutput,
            ".private/session-state",
          ),
        /public output root and stable session-control directory must not overlap/u,
      );
    }
    assert.throws(
      () =>
        resolveSessionLayout(
          root,
          "invalid-normalization-alias",
          "src-ge\u0301n/index.ts",
          ".genes/dev-normalization",
        ),
      /path-escape/u,
      "non-NFC output spellings must fail before they can create another authority scope",
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

for (const invalidArgs of [
  ["build.hxml", "--connect", "6000"],
  ["build.hxml", "-D", "genes.output=stolen.ts"],
  ["build.hxml", "--next"],
  ["build.hxml", "--each"],
]) {
  assert.throws(() =>
    snapshotHaxeInvocation({
      executable: "haxe",
      cwd: process.cwd(),
      args: invalidArgs,
      ioPolicy: "haxe-4.3.7-development-js-v1",
      compatibilityFacts: { fixture: invalidArgs.join(" ") },
    }),
  );
}

for (const forbidden of [
  "-D genes.output=src-gen/index.ts",
  "-D genes.tooling.prepared=caller-owned",
  "--connect 6000",
  "--wait 6000",
  "--server-listen 127.0.0.1:6000",
  "--server-connect 127.0.0.1:6000",
  "--run Main",
  "-cmd touch-public",
  "--interp",
  "-x Main",
  "--xml public-api.xml",
  "-xml public-api.xml",
  "--json public-api.json",
  "-js public.js",
  "--js public.js",
  "-swf public.swf",
  "--swf public.swf",
  "--neko public.n",
  "-neko public.n",
  "--php public-php",
  "-php public-php",
  "--cpp public-cpp",
  "-cpp public-cpp",
  "-cppia public.cppia",
  "--cs public-cs",
  "-cs public-cs",
  "--java public-java",
  "-java public-java",
  "--jvm public.jar",
  "--python public.py",
  "-python public.py",
  "--lua public.lua",
  "-lua public.lua",
  "--hl public.hl",
  "-hl public.hl",
  "--cppia public.cppia",
  "--no-output",
  "--display Main.hx@0",
  "--prompt",
  "-prompt",
  "--version",
  "-version",
  "--help",
  "-help",
  "-h",
  "--help-defines",
  "--help-user-defines",
  "--help-metas",
  "--help-user-metas",
  "--haxelib-global",
  "-C alternate",
  "--cwd alternate",
  "-r asset.txt",
  "-resource asset.txt",
  "--resource asset.txt",
  "--swf-lib native.swf",
  "-swf-lib native.swf",
  "--java-lib native.jar",
  "-java-lib native.jar",
  "--net-lib native.dll",
  "-net-lib native.dll",
  "--net-std native-root",
  "-net-std native-root",
  "--c-arg native-argument",
  "-c-arg native-argument",
  "-D dump",
  "-D dump-path=public-dump",
  "-D dump-dependencies",
  "-D message.log-file=public-messages.log",
  "-D gen_hx_classes",
  "--next",
  "--each",
]) {
  await withHarness(
    `nested-policy-${forbidden.replaceAll(/[^A-Za-z0-9]+/gu, "-")}`,
    async (harness) => {
      const sentinel = path.join(harness.root, "src-gen/index.ts");
      mkdirSync(path.dirname(sentinel), { recursive: true });
      writeFileSync(sentinel, "// unchanged sentinel\n", "utf8");
      writeFileSync(path.join(harness.root, "nested.hxml"), `${forbidden}\n`, "utf8");
      writeFileSync(path.join(harness.root, "build.hxml"), "nested.hxml\n", "utf8");
      await harness.session.start();
      assert.equal(harness.session.state.kind, "blocked");
      assert.equal(harness.compiler.calls, 0);
      assert.equal(readFileSync(sentinel, "utf8"), "// unchanged sentinel\n");
    },
  );
}

const lexicalPolicyFixtures: readonly {
  readonly name: string;
  readonly hxml: string;
  readonly env: Readonly<Record<string, string>>;
}[] = [
  {
    name: "quoted-xml",
    hxml: '"--xml public-api.xml"\n',
    env: {},
  },
  {
    name: "percent-option-injection",
    hxml: "%EFFECT%\npublic-api.xml\n",
    env: { EFFECT: "--xml" },
  },
] as const;
for (const fixture of lexicalPolicyFixtures) {
  await withHarness(
    `haxe-lexical-policy-${fixture.name}`,
    async (harness) => {
      await harness.session.start();
      assert.equal(harness.session.state.kind, "blocked");
      assert.equal(harness.compiler.calls, 0);
      assert.equal(existsSync(path.join(harness.root, "public-api.xml")), false);
    },
    undefined,
    (options, root) => {
      writeFileSync(path.join(root, "build.hxml"), fixture.hxml, "utf8");
      return {
        ...options,
        resolveInvocation: () => ({
          executable: "haxe",
          cwd: root,
          args: ["build.hxml"],
          env: fixture.env,
          ioPolicy: "haxe-4.3.7-development-js-v1",
          compatibilityFacts: { fixture: fixture.name },
        }),
      };
    },
  );
}

await withHarness(
  "invocation-hxml-owns-entry-closure",
  async (harness) => {
    writeFileSync(
      path.join(harness.root, "different.hxml"),
      "-cp src\n-main Main\n",
      "utf8",
    );
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "ready");
    assert.equal(harness.compiler.calls, 1);
  },
  undefined,
  (options) => ({
    ...options,
    resolveInvocation: () => ({
      executable: "haxe",
      cwd: options.projectRoot,
      args: ["different.hxml"],
      ioPolicy: "haxe-4.3.7-development-js-v1",
      compatibilityFacts: { fixture: "wrong-closure" },
    }),
  }),
);

await withHarness(
  "invocation-hxml-owns-entry-order",
  async (harness) => {
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "ready");
    assert.equal(harness.compiler.calls, 1);
  },
  undefined,
  (options, root) => {
    writeFileSync(path.join(root, "first.hxml"), "-cp src\n", "utf8");
    writeFileSync(path.join(root, "second.hxml"), "-main Main\n", "utf8");
    return {
      ...options,
      resolveInvocation: () => ({
        executable: "haxe",
        cwd: root,
        args: ["second.hxml", "first.hxml"],
        ioPolicy: "haxe-4.3.7-development-js-v1",
        compatibilityFacts: { fixture: "wrong-entry-order" },
      }),
    };
  },
);

await withHarness(
  "invocation-owns-working-directory",
  async (harness) => {
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "ready");
    assert.equal(harness.compiler.calls, 1);
  },
  undefined,
  (options, root) => {
    const nested = path.join(root, "nested");
    mkdirSync(nested);
    mkdirSync(path.join(nested, "src"));
    return {
      ...options,
      resolveInvocation: () => ({
        executable: "haxe",
        cwd: nested,
        args: ["../build.hxml"],
        ioPolicy: "haxe-4.3.7-development-js-v1",
        compatibilityFacts: { fixture: "wrong-working-directory" },
      }),
    };
  },
);

await withHarness(
  "invocation-extra-arguments",
  async (harness) => {
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    assert.equal(harness.compiler.calls, 0);
  },
  undefined,
  (options, root) => ({
    ...options,
    resolveInvocation: () => ({
      executable: "haxe",
      cwd: root,
      args: ["build.hxml", "-cp", "../shared"],
      ioPolicy: "haxe-4.3.7-development-js-v1",
      compatibilityFacts: { fixture: "extra-arguments" },
    }),
  }),
);

{
  const outside = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-session-outside-source-")),
  );
  const harness = makeHarness("symlinked-class-path-entry");
  try {
    mkdirSync(path.join(outside, "package"));
    writeFileSync(
      path.join(outside, "package", "Hidden.hx"),
      "package package; class Hidden {}\n",
      "utf8",
    );
    symlinkSync(
      path.join(outside, "package"),
      path.join(harness.root, "src", "package"),
    );
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    assert.equal(harness.compiler.calls, 0);
  } finally {
    await harness.session.close();
    rmSync(harness.root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

await withHarness("hxml-changes-before-execution", async (harness) => {
  harness.compiler.steps.push({
    beforeInvocationGuard: () => {
      writeFileSync(
        path.join(harness.root, "build.hxml"),
        "-D genes.output=src-gen/index.ts\n",
        "utf8",
      );
    },
  });
  await harness.session.start();
  await harness.session.waitForIdle();
  assert.equal(harness.session.state.kind, "blocked");
  assert.equal(harness.compiler.calls, 1);
  assert.equal(harness.compiler.modes.length, 0);
  assert.equal(existsSync(path.join(harness.root, "src-gen/index.ts")), false);
});

await withHarness(
  "library-resolution-replans-before-execution",
  async (harness) => {
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "ready");
    assert.equal(harness.compiler.calls, 1);
    assert.equal(harness.compiler.modes.length, 1);
    const executed = harness.compiler.invocations[0]!.arguments;
    assert.equal(executed.includes(path.join(harness.root, "libraries", "first")), false);
    assert.equal(executed.includes(path.join(harness.root, "libraries", "second")), true);
  },
  undefined,
  (options, root) => {
    const first = path.join(root, "libraries", "first");
    const second = path.join(root, "libraries", "second");
    mkdirSync(first, { recursive: true });
    mkdirSync(second, { recursive: true });
    const provenance = path.join(root, "libraries", "sample.hxml");
    writeFileSync(provenance, "# resolver provenance\n", "utf8");
    writeFileSync(
      path.join(root, "build.hxml"),
      "-lib sample\n-main Main\n",
      "utf8",
    );
    let calls = 0;
    return {
      ...options,
      hxml: {
        ...options.hxml,
        resolveLibrary: () => ({
          arguments: ["-cp", ++calls === 1 ? first : second],
          provenanceFiles: [provenance],
        }),
      },
    };
  },
);

{
  const mutableArgs = ["build.hxml"];
  const mutableEnv: Record<string, string> = { SESSION_FLAG: "before" };
  const mutableFacts: { version: string } = { version: "before" };
  let inventoryCalls = 0;
  const harness = makeHarness(
    "changed-invocation-is-rejected-before-execution",
    (dependencies) => ({
      ...dependencies,
      inventory: async (options) => {
        inventoryCalls += 1;
        if (inventoryCalls === 3) {
          mutableArgs.push("--next", "second.hxml");
          mutableEnv.SESSION_FLAG = "after";
          mutableFacts.version = "after";
        }
        return await inventoryHxml(options);
      },
    }),
    (options) => ({
      ...options,
      resolveInvocation: () => ({
        executable: "haxe",
        cwd: options.projectRoot,
        args: mutableArgs,
        env: mutableEnv,
        ioPolicy: "haxe-4.3.7-development-js-v1",
        compatibilityFacts: mutableFacts,
      }),
    }),
  );
  try {
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    assert.equal(harness.compiler.calls, 1);
    assert.equal(harness.compiler.modes.length, 0);
    assert.deepEqual(
      harness.compiler.invocations[0]?.sourceInvocation.args,
      ["build.hxml"],
    );
    assert.equal(
      harness.compiler.invocations[0]?.environment.SESSION_FLAG,
      "before",
    );
    assert.deepEqual(
      harness.compiler.invocations[0]?.sourceInvocation.compatibilityFacts,
      { version: "before" },
    );
  } finally {
    await harness.session.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
}

const diagnosticCorruptions: Array<{
  readonly name: string;
  readonly apply: (outputRoot: string, owner: string) => void;
}> = [
  {
    name: "missing-manifest",
    apply: (outputRoot, owner) =>
      rmSync(path.join(outputRoot, manifestName(owner)), { force: true }),
  },
  {
    name: "malformed-manifest",
    apply: (outputRoot, owner) =>
      writeFileSync(path.join(outputRoot, manifestName(owner)), "not a manifest\n"),
  },
  {
    name: "candidate-symlink",
    apply: (outputRoot, owner) =>
      symlinkSync(path.join(outputRoot, owner), path.join(outputRoot, "leak.ts")),
  },
  {
    name: "unowned-candidate-file",
    apply: (outputRoot) =>
      writeFileSync(path.join(outputRoot, "unowned.ts"), "// unowned\n"),
  },
];
if (process.platform !== "win32") {
  diagnosticCorruptions.push({
    name: "candidate-special-file",
    apply: (outputRoot) => {
      const fifo = path.join(outputRoot, "special.pipe");
      const result = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    },
  });
}

for (const corruption of diagnosticCorruptions) {
  await withHarness(`diagnostic-${corruption.name}`, async (harness) => {
    harness.compiler.steps.push({ afterGenerate: corruption.apply });
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    const publicRecord = JSON.stringify({
      snapshot: harness.session.inspect(),
      events: harness.events,
    });
    assert.equal(
      publicRecord.includes(harness.root),
      false,
      `${corruption.name} exposed the absolute project root`,
    );
    assert.equal(
      /revision-\d+-test\d+/u.test(publicRecord),
      false,
      `${corruption.name} exposed a private candidate nonce`,
    );
  });
}

await withHarness("diagnostic-multiple-candidate-paths", async (harness) => {
  harness.compiler.steps.push({
    fail: (candidateOutputFile) =>
      `first ${candidateOutputFile}; second ${candidateOutputFile}`,
  });
  await harness.session.start();
  await harness.session.waitForIdle();
  assert.equal(harness.session.state.kind, "blocked");
  const publicRecord = JSON.stringify({
    snapshot: harness.session.inspect(),
    events: harness.events,
  });
  assert.equal(publicRecord.includes(harness.root), false);
  assert.equal(/revision-\d+-test\d+/u.test(publicRecord), false);
  assert.equal(publicRecord.includes("<private-candidate>"), true);
});

await withHarness(
  "validator-diagnostic-private-path-redaction",
  async (harness) => {
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    const publicRecord = JSON.stringify({
      snapshot: harness.session.inspect(),
      events: harness.events,
    });
    assert.equal(publicRecord.includes(harness.root), false);
    const alternateRoot = harness.root
      .split(path.sep)
      .join(path.sep === "/" ? "\\" : "/");
    assert.equal(
      publicRecord.includes(alternateRoot),
      false,
      "host diagnostics must hide private paths written with either slash style",
    );
    assert.equal(/revision-\d+-test\d+/u.test(publicRecord), false);
    assert.equal(publicRecord.includes("<private-candidate>"), true);
  },
  undefined,
  (options) => ({
    ...options,
    validate: async (tree) => {
      const alternateRoot = tree.physicalRoot
        .split(path.sep)
        .join(path.sep === "/" ? "\\" : "/");
      return {
        ok: false,
        diagnostic: {
          code: "HOST_REJECTED",
          message: `candidate ${alternateRoot}`,
          [alternateRoot]: "path used as an object key",
          nested: [
            tree.files[0]!.physicalPath
              .split(path.sep)
              .join(path.sep === "/" ? "\\" : "/"),
            { again: alternateRoot },
          ],
        },
      };
    },
  }),
);

await withHarness(
  "preparation-diagnostic-private-path-redaction",
  async (harness) => {
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    const publicRecord = JSON.stringify({
      snapshot: harness.session.inspect(),
      events: harness.events,
    });
    assert.equal(publicRecord.includes(harness.root), false);
    assert.equal(publicRecord.includes("<project>"), true);
  },
  undefined,
  (options, root) => ({
    ...options,
    prepareRevision: () => ({
      ok: false,
      diagnostic: {
        code: "PREPARATION_FAILED",
        message: `could not prepare ${root}`,
        [root]: "path used as an object key",
        nested: [root, { again: root }],
      },
    }),
  }),
);

await withHarness(
  "prepared-compiler-inputs-publish-with-one-generation",
  async (harness) => {
    harness.compiler.steps.push(
      { content: "export const revision = 1;\n" },
      { content: "export const revision = 2;\n" },
    );
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "ready");

    const companion = path.join(harness.root, "generated-haxe/CardStyles.hx");
    const receipt = path.join(harness.root, "generated-haxe/host-receipt.json");
    const firstCompanion = readFileSync(companion, "utf8");
    const firstReceipt = readFileSync(receipt, "utf8");
    const firstOutput = readFileSync(
      path.join(harness.root, "src-gen/index.ts"),
      "utf8",
    );

    harness.session.invalidate({
      path: "src/Main.hx",
      impact: { rebuild: true },
    });
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "degraded");
    assert.equal(harness.compiler.preparedRequests.length, 2);
    assert.notEqual(
      harness.compiler.preparedRequests[0]?.digest,
      harness.compiler.preparedRequests[1]?.digest,
      "changed prepared bytes change the Haxe request cache identity",
    );
    assert.equal(readFileSync(companion, "utf8"), firstCompanion);
    assert.equal(readFileSync(receipt, "utf8"), firstReceipt);
    assert.equal(
      readFileSync(path.join(harness.root, "src-gen/index.ts"), "utf8"),
      firstOutput,
    );
  },
  undefined,
  (options) => ({
    ...options,
    prepareRevision: async ({ revision }) => ({
      ok: true,
      prepared: {
        classPaths: ["haxe"],
        files: [
          {
            relativePath: "haxe/CardStyles.hx",
            content: `typedef CardStyles = { final revision${revision}:String; }\n`,
            publishPath: "generated-haxe/CardStyles.hx",
          },
        ],
      },
    }),
    validate: async (tree) => {
      assert.equal(tree.extraFiles.length, 1);
      assert.equal(
        tree.extraFiles[0]?.logicalPath,
        "generated-haxe/CardStyles.hx",
      );
      if (tree.revision === 2) {
        return {
          ok: false,
          diagnostic: {
            code: "EXPECTED_REJECTION",
            message: "the second prepared revision is deliberately rejected",
          },
        };
      }
      return {
        ok: true,
        artifacts: [
          {
            path: "generated-haxe/host-receipt.json",
            content: "{\"accepted\":1}\n",
          },
        ],
      };
    },
  }),
);

for (const reservedPath of ["output", "haxe-input", "haxe-target"] as const) {
  await withHarness(
    `prepared-input-reserved-stage-path-${reservedPath}`,
    async (harness) => {
      harness.compiler.steps.push({ content: "export const value = 1;\n" });
      await harness.session.start();
      await harness.session.waitForIdle();
      assert.equal(harness.session.state.kind, "blocked");
      assert.equal(
        harness.compiler.calls,
        0,
        "private session folders must be rejected before Haxe reads them",
      );
      assert.equal(
        existsSync(path.join(harness.root, "src-gen/index.ts")),
        false,
      );
    },
    undefined,
    (options) => ({
      ...options,
      prepareRevision: () => ({
        ok: true,
        prepared: {
          classPaths: [reservedPath],
          files: [
            {
              relativePath: `${reservedPath}/Injected.hx`,
              content: "class Injected {}\n",
            },
          ],
        },
      }),
    }),
  );
}

await withHarness(
  "prepared-public-portable-class-path-alias",
  async (harness) => {
    harness.compiler.steps.push({ content: "export const value = 1;\n" });
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    assert.equal(
      harness.compiler.calls,
      0,
      "a portable alias of an authored class path must fail before compilation",
    );
    assert.equal(existsSync(path.join(harness.root, "SRC/Generated.hx")), false);
  },
  undefined,
  (options) => ({
    ...options,
    prepareRevision: () => ({
      ok: true,
      prepared: {
        classPaths: ["haxe"],
        files: [
          {
            relativePath: "haxe/Generated.hx",
            content: "class Generated {}\n",
            publishPath: "SRC/Generated.hx",
          },
        ],
      },
    }),
  }),
);

await withHarness(
  "prepared-public-library-provenance-input",
  async (harness) => {
    harness.compiler.steps.push({ content: "export const value = 1;\n" });
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    assert.equal(
      harness.compiler.calls,
      0,
      "a library's resolution record is authored compiler input and must stay untouched",
    );
  },
  undefined,
  (options, root) => {
    const libraryRoot = path.join(root, "libraries/sample");
    const provenance = path.join(root, "libraries/sample.hxml");
    mkdirSync(libraryRoot, { recursive: true });
    writeFileSync(provenance, "# library resolution evidence\n", "utf8");
    writeFileSync(
      path.join(root, "build.hxml"),
      "-lib sample\n-main Main\n",
      "utf8",
    );
    return {
      ...options,
      hxml: {
        ...options.hxml,
        resolveLibrary: () => ({
          arguments: ["-cp", libraryRoot],
          provenanceFiles: [provenance],
        }),
      },
      prepareRevision: () => ({
        ok: true,
        prepared: {
          classPaths: ["haxe"],
          files: [
            {
              relativePath: "haxe/Generated.hx",
              content: "class Generated {}\n",
              publishPath: "libraries/sample.hxml",
            },
          ],
        },
      }),
    };
  },
);

await withHarness(
  "prepared-stale-file-removal",
  async (harness) => {
    harness.compiler.steps.push(
      { content: "export const revision = 1;\n" },
      { content: "export const revision = 2;\n" },
    );
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(existsSync(path.join(harness.root, "public/old.json")), true);
    currentWatch(harness).change(harness.source);
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "ready");
    assert.equal(existsSync(path.join(harness.root, "public/old.json")), false);
    assert.deepEqual(harness.session.inspect().accepted?.files.deleted, [
      "public/old.json",
    ]);
  },
  undefined,
  (options) => ({
    ...options,
    prepareRevision: ({ revision }) => ({
      ok: true,
      prepared: {
        classPaths: ["haxe"],
        files: [
          {
            relativePath: "haxe/Companion.hx",
            content: `class Companion { public static final revision = ${revision}; }\n`,
            publishPath: "public/Companion.hx",
          },
          ...(revision === 1
            ? [
                {
                  relativePath: "evidence/old.json",
                  content: "{\"revision\":1}\n",
                  publishPath: "public/old.json",
                },
              ]
            : []),
        ],
      },
    }),
  }),
);

await withHarness(
  "prepared-stale-file-drift",
  async (harness) => {
    harness.compiler.steps.push(
      { content: "export const revision = 1;\n" },
      { content: "export const revision = 2;\n" },
    );
    await harness.session.start();
    await harness.session.waitForIdle();
    const old = path.join(harness.root, "public/old.json");
    writeFileSync(old, "{\"outside\":true}\n", "utf8");
    currentWatch(harness).change(harness.source);
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "degraded");
    assert.equal(readFileSync(old, "utf8"), "{\"outside\":true}\n");
    assert.equal(
      readFileSync(path.join(harness.root, "src-gen/index.ts"), "utf8"),
      "export const revision = 1;\n",
    );
  },
  undefined,
  (options) => ({
    ...options,
    prepareRevision: ({ revision }) => ({
      ok: true,
      prepared: {
        classPaths: ["haxe"],
        files: [
          {
            relativePath: "haxe/Companion.hx",
            content: `class Companion { public static final revision = ${revision}; }\n`,
          },
          ...(revision === 1
            ? [
                {
                  relativePath: "evidence/old.json",
                  content: "{\"revision\":1}\n",
                  publishPath: "public/old.json",
                },
              ]
            : []),
        ],
      },
    }),
  }),
);

await withHarness(
  "published-prepared-file-cannot-become-authored-input",
  async (harness) => {
    harness.compiler.steps.push({ content: "export const revision = 1;\n" });
    await harness.session.start();
    await harness.session.waitForIdle();
    const companion = path.join(
      harness.root,
      "generated-haxe/CardStyles.hx",
    );
    const acceptedBytes = readFileSync(companion, "utf8");

    writeFileSync(
      path.join(harness.root, "build.hxml"),
      "-cp src\n-cp generated-haxe\n-main Main\n",
      "utf8",
    );
    currentWatch(harness).change(path.join(harness.root, "build.hxml"));
    await harness.session.waitForIdle();

    assert.equal(harness.session.state.kind, "degraded");
    assert.equal(harness.compiler.calls, 1);
    assert.equal(
      readFileSync(companion, "utf8"),
      acceptedBytes,
      "the session must not delete a prior generated file after HXML makes it authored input",
    );
  },
  undefined,
  (options) => ({
    ...options,
    prepareRevision: ({ revision }) => ({
      ok: true,
      prepared: {
        classPaths: ["haxe"],
        files: [
          {
            relativePath: "haxe/CardStyles.hx",
            content: `typedef CardStyles = { final revision${revision}:String; }\n`,
            publishPath: "generated-haxe/CardStyles.hx",
          },
        ],
      },
    }),
  }),
);

await withHarness(
  "published-prepared-path-spelling-cannot-change",
  async (harness) => {
    harness.compiler.steps.push(
      { content: "export const revision = 1;\n" },
      { content: "export const revision = 2;\n" },
    );
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "ready");
    const acceptedPath = path.join(
      harness.root,
      "generated-haxe/CardStyles.hx",
    );
    const acceptedBytes = readFileSync(acceptedPath, "utf8");

    harness.session.invalidate({
      path: "src/Main.hx",
      impact: { rebuild: true },
    });
    await harness.session.waitForIdle();

    const degraded = currentState(harness);
    assert.equal(degraded.kind, "degraded");
    assert.match(
      String(degraded.failure.diagnostic.message),
      /supplemental file path spelling changed/u,
      "a non-portable rename should be explained before publication starts",
    );
    assert.equal(readFileSync(acceptedPath, "utf8"), acceptedBytes);
    assert.deepEqual(
      readdirSync(path.join(harness.root, "generated-haxe")),
      ["CardStyles.hx"],
      "the accepted path spelling remains unchanged",
    );
  },
  undefined,
  (options) => ({
    ...options,
    prepareRevision: ({ revision }) => ({
      ok: true,
      prepared: {
        classPaths: ["haxe"],
        files: [
          {
            relativePath: "haxe/CardStyles.hx",
            content: `typedef CardStyles = { final revision${revision}:String; }\n`,
            publishPath:
              revision === 1
                ? "generated-haxe/CardStyles.hx"
                : "Generated-Haxe/CardStyles.hx",
          },
        ],
      },
    }),
  }),
);

await withHarness(
  "prepared-public-generated-output-collision",
  async (harness) => {
    harness.compiler.steps.push({ content: "export const value = 1;\n" });
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    assert.equal(existsSync(path.join(harness.root, "src-gen/index.ts")), false);
  },
  undefined,
  (options) => ({
    ...options,
    prepareRevision: () => ({
      ok: true,
      prepared: {
        classPaths: ["haxe"],
        files: [
          {
            relativePath: "haxe/Companion.hx",
            content: "class Companion {}\n",
            publishPath: "src-gen/index.ts",
          },
        ],
      },
    }),
  }),
);

for (const collisionPath of [
  "src-gen",
  "src-gen/index.ts/receipt.json",
] as const) {
  await withHarness(
    `prepared-public-generated-output-tree-collision-${collisionPath.replaceAll("/", "-")}`,
    async (harness) => {
      harness.compiler.steps.push({ content: "export const value = 1;\n" });
      await harness.session.start();
      await harness.session.waitForIdle();
      assert.equal(harness.session.state.kind, "blocked");
      if (harness.session.state.kind === "blocked") {
        assert.match(
          String(harness.session.state.failure.diagnostic.message),
          /prepared or admitted artifact collides with generated output/u,
          "parent and child output collisions should be explained before publication starts",
        );
      }
      assert.equal(existsSync(path.join(harness.root, "src-gen/index.ts")), false);
    },
    undefined,
    (options) => ({
      ...options,
      prepareRevision: () => ({
        ok: true,
        prepared: {
          classPaths: ["haxe"],
          files: [
            {
              relativePath: "haxe/Companion.hx",
              content: "class Companion {}\n",
              publishPath: collisionPath,
            },
          ],
        },
      }),
    }),
  );
}

await withHarness(
  "prepared-and-admitted-public-collision",
  async (harness) => {
    harness.compiler.steps.push({ content: "export const value = 1;\n" });
    await harness.session.start();
    await harness.session.waitForIdle();
    assert.equal(harness.session.state.kind, "blocked");
    assert.equal(existsSync(path.join(harness.root, "public/evidence.json")), false);
  },
  undefined,
  (options) => ({
    ...options,
    prepareRevision: () => ({
      ok: true,
      prepared: {
        classPaths: ["haxe"],
        files: [
          {
            relativePath: "haxe/Companion.hx",
            content: "class Companion {}\n",
            publishPath: "public/evidence.json",
          },
        ],
      },
    }),
    validate: async () => ({
      ok: true,
      artifacts: [
        { path: "public/evidence.json", content: "{\"accepted\":true}\n" },
      ],
    }),
  }),
);
console.log("genes tooling development session runtime: ok");
