/**
 * Focused tests of the module-first path of `DevelopmentSession`
 * (`GenesDevelopmentOptions.modulePreview`, genes-f8vc.14.3).
 *
 * What the path does: after a save of one Haxe module, the session first
 * sends a module request (only that module is the root), and shows its
 * files as a preview when Genes admits them. After a quiet time it sends
 * the program request, which stays the only writer of the public tree, and
 * compares each preview file with the program's candidate.
 *
 * These tests use a controlled compiler (no Haxe): it writes the Genes
 * report and files that a module request or a program request writes. The
 * real Haxe path is in `session-module-preview-warm-test.ts`.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { publishArtifacts, recoverArtifacts } from "./artifacts/index.js";
import { inventoryHxml } from "./hxml/index.js";
import type { HaxeWaitServerEvent } from "./haxe-server/index.js";
import { establishSessionAuthority } from "./session/authority-migration.js";
import { moduleRequestArguments } from "./session/effective-invocation.js";
import type {
  ModuleCompileOutcome,
  PreparedCompilerRequest,
  SessionCompiler,
} from "./session/haxe-driver.js";
import type { SessionLayout } from "./session/layout.js";
import {
  createGenesDevelopmentSessionWithDependencies,
  type SessionDependencies,
} from "./session/runtime.js";
import { acquireSessionLock } from "./session/session-lock.js";
import { summarizePreviewTimings } from "./session/index.js";
import type {
  DevelopmentEvent,
  DevelopmentEventBody,
  DevelopmentSession,
  GenesDevelopmentOptions,
  JsonValue,
} from "./session/types.js";
import type {
  ReconciledWatchChange,
  ReconciledWatchOptions,
  ReconciledWatchSession,
  ReconciliationResult,
  WatchInput,
} from "./watch/index.js";

type BoundInvocation = Parameters<SessionCompiler["compile"]>[0];

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

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The ownership manifest name that Genes writes beside `index.ts`. */
function manifestName(owner: string): string {
  const readable = owner.replaceAll(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 48);
  return `.genes-output-${readable}-${sha256(owner)}.manifest`;
}

/** Writes a fake Genes tree: the files and the ownership manifest. */
function writeTree(outputFile: string, files: Readonly<Record<string, string>>): void {
  const root = path.dirname(outputFile);
  const owner = path.basename(outputFile);
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split("/"));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }
  const entries = Object.keys(files).sort();
  writeFileSync(
    path.join(root, manifestName(owner)),
    `genes-output-manifest-v2\nowner-base64:${Buffer.from(owner).toString("base64")}\n${entries.join("\n")}\n`,
    "utf8",
  );
}

/** One program request of the controlled compiler. */
interface ProgramStep {
  /** Files beside `index.ts`; default: the compiler's current `tree`. */
  readonly files?: Readonly<Record<string, string>>;
  readonly fail?: string;
  /** Resolved when the request has started. */
  readonly started?: Deferred<void>;
  /** The request waits for this, or for its abort signal. */
  readonly hold?: Deferred<void>;
}

/** One module request of the controlled compiler. */
type ModuleStep =
  | {
      readonly kind: "preview";
      /** Default: the module's file from the compiler's current `tree`. */
      readonly files?: Readonly<Record<string, string>>;
      readonly hold?: Deferred<void>;
    }
  | { readonly kind: "refused"; readonly refusal: string }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "unavailable" }
  | { readonly kind: "no-report" };

/** What one request of the controlled compiler saw. */
interface RequestRecord {
  readonly kind: "program" | "module";
  readonly startedAt: number;
  endedAt: number;
  readonly arguments: readonly string[];
  readonly descriptor: Readonly<Record<string, JsonValue>>;
  readonly outputFile: string;
  readonly invalidated: readonly string[];
  /** The prepared inputs of the request (`prepareRevision`). */
  readonly prepared?: PreparedCompilerRequest;
}

/** A request that has started, with the descriptor texts that it read. */
interface StartedRequest {
  readonly record: RequestRecord;
  readonly descriptorText: string;
  readonly outputDescriptorText: string;
}

/**
 * A `SessionCompiler` that writes what Genes writes for a program request
 * and a module request, and checks the rules that the real server needs:
 * one request at a time, and no descriptor written while a request runs.
 */
class PreviewCompiler implements SessionCompiler {
  readonly programSteps: ProgramStep[] = [];
  readonly moduleSteps: ModuleStep[] = [];
  readonly requests: RequestRecord[] = [];
  /** The Genes files of the current sources, relative to the output folder. */
  tree: Record<string, string> = {};
  #inFlight = false;

  #descriptorPath(invocation: BoundInvocation): string {
    const define = invocation.arguments.find((argument) =>
      argument.startsWith("genes.dev_incremental="),
    );
    assert.notEqual(define, undefined, "every request needs the incremental descriptor");
    return define!.slice("genes.dev_incremental=".length);
  }

  #outputDescriptorPath(invocation: BoundInvocation): string {
    const define = invocation.arguments.find((argument) =>
      argument.startsWith("genes.output_descriptor="),
    );
    assert.notEqual(define, undefined, "every request needs the output descriptor");
    return define!.slice("genes.output_descriptor=".length);
  }

  /** Records one request and checks that no other request is in flight. */
  #begin(
    kind: RequestRecord["kind"],
    invocation: BoundInvocation,
    invalidated: readonly string[],
    prepared?: PreparedCompilerRequest,
  ): StartedRequest {
    assert.equal(this.#inFlight, false, "two requests overlapped on one server");
    this.#inFlight = true;
    const descriptorText = readFileSync(this.#descriptorPath(invocation), "utf8");
    const outputDescriptorText = readFileSync(this.#outputDescriptorPath(invocation), "utf8");
    // The output descriptor names this request's own output file.
    const lines = outputDescriptorText.split("\n");
    assert.equal(lines[0], "genes.output-descriptor-v1");
    assert.equal(
      Buffer.from(lines[1]!, "base64").toString("utf8"),
      invocation.candidateOutputFile,
      `${kind} request: the output descriptor names another request`,
    );
    const record: RequestRecord = {
      kind,
      startedAt: Date.now(),
      endedAt: 0,
      arguments: invocation.arguments,
      descriptor: JSON.parse(descriptorText) as Record<string, JsonValue>,
      outputFile: invocation.candidateOutputFile,
      invalidated: [...invalidated],
      ...(prepared === undefined ? {} : { prepared }),
    };
    for (const classPath of prepared?.classPaths ?? []) {
      assert.equal(existsSync(classPath), true, `${kind} request: a prepared class path is missing`);
    }
    this.requests.push(record);
    return { record, descriptorText, outputDescriptorText };
  }

  /** Checks that nobody rewrote a descriptor while the request ran. */
  #end(invocation: BoundInvocation, started: StartedRequest): void {
    assert.equal(
      readFileSync(this.#descriptorPath(invocation), "utf8"),
      started.descriptorText,
      "the incremental descriptor changed while a request was in flight",
    );
    assert.equal(
      readFileSync(this.#outputDescriptorPath(invocation), "utf8"),
      started.outputDescriptorText,
      "the output descriptor changed while a request was in flight",
    );
    started.record.endedAt = Date.now();
    this.#inFlight = false;
  }

  async compile(
    invocation: BoundInvocation,
    _compatibilityDigest: string,
    _signal: AbortSignal,
    assertInvocationCurrent?: () => void | Promise<void>,
    prepared?: PreparedCompilerRequest,
    invalidatedFiles: readonly string[] = [],
  ): Promise<{ readonly mode: "connected" | "direct" }> {
    const started = this.#begin("program", invocation, invalidatedFiles, prepared);
    try {
      await assertInvocationCurrent?.();
      const step = this.programSteps.shift() ?? {};
      step.started?.resolve();
      if (step.hold !== undefined) {
        await Promise.race([
          step.hold.promise,
          new Promise<never>((_resolve, reject) =>
            _signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
          ),
        ]);
      }
      if (step.fail !== undefined) throw new Error(step.fail);
      writeTree(invocation.candidateOutputFile, {
        [path.basename(invocation.candidateOutputFile)]: "export const entry = true;\n",
        ...(step.files ?? this.tree),
      });
      return { mode: "connected" };
    } finally {
      this.#end(invocation, started);
    }
  }

  async compileModule(
    invocation: BoundInvocation,
    _compatibilityDigest: string,
    signal: AbortSignal,
    prepared?: PreparedCompilerRequest,
    invalidatedFiles: readonly string[] = [],
  ): Promise<ModuleCompileOutcome> {
    const started = this.#begin("module", invocation, invalidatedFiles, prepared);
    try {
      const step = this.moduleSteps.shift() ?? { kind: "preview" };
      const module = String(started.record.descriptor.module);
      const report = `${this.#descriptorPath(invocation)}.report.json`;
      switch (step.kind) {
        case "unavailable":
          return { kind: "unavailable", reason: "no-warm-server" };
        case "failed":
          return { kind: "failed", message: step.message };
        case "no-report":
          return { kind: "compiled" };
        case "refused":
          writeFileSync(report, JSON.stringify({
            format: 2, kind: "module", module, result: "refused",
            refusal: step.refusal, reason: `refused: ${step.refusal}`, files: [],
          }), "utf8");
          return { kind: "compiled" };
        case "preview": {
          if (step.hold !== undefined) {
            await Promise.race([
              step.hold.promise,
              new Promise<never>((_resolve, reject) =>
                signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
              ),
            ]);
          }
          const own = `${module.split(".").join("/")}.ts`;
          const files = step.files ?? { [own]: this.tree[own] ?? "" };
          // Genes writes its ownership manifest beside the module's files.
          writeTree(invocation.candidateOutputFile, files);
          writeFileSync(report, JSON.stringify({
            format: 2, kind: "module", module, result: "preview",
            refusal: null, reason: null, files: Object.keys(files).sort(),
          }), "utf8");
          return { kind: "compiled" };
        }
      }
    } finally {
      this.#end(invocation, started);
    }
  }

  async close(): Promise<void> {}
}

class FakeWatch<Cause> implements ReconciledWatchSession {
  readonly options: ReconciledWatchOptions<Cause>;

  constructor(options: ReconciledWatchOptions<Cause>) {
    this.options = options;
    options.onRegistered?.();
  }

  change(
    absolutePath: string,
    existence: ReconciledWatchChange<Cause>["existence"] = "modified",
  ): void {
    const input = this.options.inputs.find((candidate) => owns(candidate, absolutePath));
    assert.notEqual(input, undefined, `no watch input owns ${absolutePath}`);
    this.options.onChange({ path: absolutePath, cause: input!.cause, origin: "native", existence });
  }

  reconcile(): ReconciliationResult {
    return Object.freeze({ ok: true, changed: false });
  }

  close(): void {}
}

function owns<Cause>(input: WatchInput<Cause>, absolute: string): boolean {
  if (input.kind === "exact") return input.path === absolute;
  const relative = path.relative(input.path, absolute).split(path.sep).join("/");
  return relative.length > 0 && !relative.startsWith("../") && input.include(relative);
}

interface Harness {
  readonly root: string;
  readonly compiler: PreviewCompiler;
  readonly events: DevelopmentEvent<JsonValue>[];
  readonly session: DevelopmentSession<JsonValue>;
  /** Writes a source file and reports it to the session's watch. */
  save(relative: string, text: string, existence?: ReconciledWatchChange<unknown>["existence"]): void;
}

const BUTTON = "src/ui/Button.hx";
const CARD = "src/ui/Card.hx";

async function withHarness(
  name: string,
  run: (harness: Harness) => Promise<void>,
  configure: (
    options: GenesDevelopmentOptions<JsonValue>,
  ) => GenesDevelopmentOptions<JsonValue> = (options) => options,
): Promise<void> {
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), `genes-preview-${name}-`)));
  mkdirSync(path.join(root, "src", "ui"), { recursive: true });
  writeFileSync(path.join(root, "src", "Main.hx"), "class Main {}\n", "utf8");
  writeFileSync(path.join(root, BUTTON), "package ui;\nclass Button {}\n", "utf8");
  writeFileSync(path.join(root, CARD), "package ui;\nclass Card {}\n", "utf8");
  // Every kind of root that a module request must leave out: `-main`, a
  // class name, and `--macro include(...)`.
  writeFileSync(
    path.join(root, "build.hxml"),
    "-cp src\n-main Main\n--macro include('ui')\nui.Card\n-dce std\n--macro haxe.macro.Compiler.include('other')\n",
    "utf8",
  );
  const compiler = new PreviewCompiler();
  compiler.tree = {
    "ui/Button.ts": "export const button = 1;\n",
    "ui/Card.ts": "export const card = 1;\n",
  };
  const watches: FakeWatch<unknown>[] = [];
  let nonce = 0;
  const dependencies: SessionDependencies<JsonValue> = {
    now: () => Date.now(),
    inventory: inventoryHxml,
    watch: <Cause>(options: ReconciledWatchOptions<Cause>) => {
      const watch = new FakeWatch(options);
      watches.push(watch as FakeWatch<unknown>);
      return watch;
    },
    createCompiler: (
      _layout: SessionLayout,
      _onEvent: (event: HaxeWaitServerEvent) => void,
    ) => compiler,
    publish: publishArtifacts,
    recover: recoverArtifacts,
    acquireLock: acquireSessionLock,
    establishAuthority: async (layout) =>
      await establishSessionAuthority(layout, { publish: publishArtifacts, recover: recoverArtifacts }),
    nonce: () => `n${++nonce}`,
  };
  const options = configure({
    projectRoot: root,
    projectIdentity: `preview-${name}`,
    hxml: { allowedRoots: [root] },
    publicOutputFile: "src-gen/index.ts",
    stateDirectory: ".genes/dev",
    resolveInvocation: () => ({
      executable: "haxe",
      cwd: root,
      args: ["build.hxml"],
      ioPolicy: "haxe-4.3.7-development-js-v1",
      compatibilityFacts: { fixture: name },
    }),
    validate: async () => ({ ok: true }),
    validatorPolicyFacts: { fixture: "accept" },
    generationReuse: { coldCheckEvery: 0 },
    modulePreview: { quietMs: 0 },
    debounceMs: 0,
    pollIntervalMs: 10,
    shutdownTimeoutMs: 20,
  });
  const session = createGenesDevelopmentSessionWithDependencies(options, dependencies);
  const events: DevelopmentEvent<JsonValue>[] = [];
  session.subscribe((event) => events.push(event));
  const harness: Harness = {
    root,
    compiler,
    events,
    session,
    save(relative, text, existence = "modified") {
      const absolute = path.join(root, ...relative.split("/"));
      writeFileSync(absolute, text, "utf8");
      const watch = watches.at(-1);
      assert.notEqual(watch, undefined);
      watch!.change(absolute, existence);
    },
  };
  try {
    await session.start();
    await session.waitForIdle();
    assert.equal(session.state.kind, "ready", `${name}: the first build failed: ${JSON.stringify(session.inspect())}`);
    await run(harness);
  } finally {
    await session.close();
    rmSync(root, { recursive: true, force: true });
  }
}

/** The bodies of the events of `kind`, in order. */
function bodies<Kind extends DevelopmentEventBody<JsonValue>["kind"]>(
  harness: Harness,
  kind: Kind,
): Extract<DevelopmentEventBody<JsonValue>, { kind: Kind }>[] {
  return harness.events
    .map((event) => event.event)
    .filter((event): event is Extract<DevelopmentEventBody<JsonValue>, { kind: Kind }> =>
      event.kind === kind);
}

function kindsAfter(harness: Harness, sequence: number): string[] {
  return harness.events
    .filter((event) => event.sequence > sequence)
    .map((event) => event.event.kind)
    .filter((kind) => kind !== "state");
}

function candidateFolders(harness: Harness): string[] {
  const folder = path.join(harness.root, ".genes/dev/candidates");
  return existsSync(folder) ? readdirSync(folder) : [];
}

// --- Arguments of a module request -------------------------------------

assert.deepEqual(
  moduleRequestArguments(
    [
      "-cp", "src",
      "-main", "Main",
      "--macro", "include('ui')",
      "ui.Card",
      "--macro", "haxe.macro.Compiler.include( 'other' )",
      "--macro", "genes.Generator.use()",
      "-D", "include(x)",
      "--main", "app.Main",
      "-m", "app.Other",
      "/private/haxe-input/inline-option-9.hxml",
      "-dce", "std",
    ],
    "ui.Button",
  ),
  [
    "-cp", "src",
    "--macro", "genes.Generator.use()",
    "-D", "include(x)",
    "/private/haxe-input/inline-option-9.hxml",
    "-dce", "std",
    "ui.Button",
  ],
  "a module request keeps every argument except the roots, and adds the module as the only root",
);

// --- Option checks ---------------------------------------------------------

for (const [options, message] of [
  [{ modulePreview: {} }, /modulePreview needs generationReuse/u],
  [{ generationReuse: {}, modulePreview: { quietMs: -1 } }, /modulePreview\.quietMs must be a whole number from 0 to 600000/u],
  [{ generationReuse: {}, modulePreview: { quietMs: 1.5 } }, /modulePreview\.quietMs must be a whole number from 0 to 600000/u],
] as const) {
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "genes-preview-options-")));
  try {
    writeFileSync(path.join(root, "build.hxml"), "-cp src\n-main Main\n", "utf8");
    assert.throws(
      () =>
        createGenesDevelopmentSessionWithDependencies<JsonValue>(
          {
            projectRoot: root,
            projectIdentity: "preview-options",
            hxml: { allowedRoots: [root] },
            publicOutputFile: "src-gen/index.ts",
            stateDirectory: ".genes/dev",
            resolveInvocation: () => ({
              executable: "haxe",
              cwd: root,
              args: ["build.hxml"],
              ioPolicy: "haxe-4.3.7-development-js-v1",
              compatibilityFacts: {},
            }),
            validate: async () => ({ ok: true }),
            validatorPolicyFacts: {},
            ...options,
          },
          {
            now: () => Date.now(),
            inventory: inventoryHxml,
            watch: <Cause>(watchOptions: ReconciledWatchOptions<Cause>) => new FakeWatch(watchOptions),
            createCompiler: () => new PreviewCompiler(),
            publish: publishArtifacts,
            recover: recoverArtifacts,
            acquireLock: acquireSessionLock,
            establishAuthority: async () => {},
            nonce: () => "n",
          },
        ),
      message,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- A preview, then the program request, then the confirmation ----------

await withHarness("confirmed", async (harness) => {
  const first = harness.compiler.requests;
  assert.deepEqual(first.map((request) => request.kind), ["program"], "the first build has no records: no module request");
  assert.equal(first[0]!.descriptor.kind, "full");
  assert.equal(first[0]!.descriptor.moduleRecords, true, "a program request keeps the facts that module requests check");
  assert.equal(first[0]!.descriptor.generation, "reuse");
  const mark = harness.session.inspect().lastSequence;
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Button.ts": "export const button = 2;\n" };
  let readDuringEvent: Uint8Array | null = null;
  const unsubscribe = harness.session.subscribe((event) => {
    if (event.event.kind === "preview-generated") {
      readDuringEvent = harness.session.readPreviewFile("src-gen/ui/Button.ts")?.bytes ?? null;
    }
  });
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 2; }\n");
  await harness.session.waitForIdle();
  unsubscribe();
  assert.deepEqual(
    kindsAfter(harness, mark),
    ["inputs-changed", "build-started", "preview-generated", "candidate-generated", "generation-accepted", "preview-confirmed"],
  );
  const [module, program] = harness.compiler.requests.slice(1);
  assert.equal(module!.kind, "module");
  assert.equal(program!.kind, "program");
  // The descriptor of the module request names the module and the program
  // that it previews.
  assert.equal(module!.descriptor.kind, "module");
  assert.equal(module!.descriptor.module, "ui.Button");
  assert.equal(module!.descriptor.programDigest, program!.descriptor.programDigest);
  assert.equal(module!.descriptor.afterTyping, "reuse");
  assert.equal(module!.descriptor.generation, "reuse");
  // Its roots: only the module.
  for (const root of ["-main", "Main", "include('ui')", "ui.Card", "haxe.macro.Compiler.include('other')"]) {
    assert.equal(module!.arguments.includes(root), false, `the module request keeps the root ${root}`);
  }
  assert.equal(module!.arguments.filter((argument) => argument === "ui.Button").length, 1);
  assert.equal(program!.arguments.includes("Main"), true, "the program request keeps its roots");
  // An output folder beside the program's, at the same depth.
  const relative = (file: string): string[] => path.relative(harness.root, file).split(path.sep);
  assert.equal(relative(module!.outputFile).length, relative(program!.outputFile).length);
  assert.notEqual(path.dirname(module!.outputFile), path.dirname(program!.outputFile));
  // The edited file is invalidated at most once, by the first request
  // after the save; the program request does not type it again.
  const button = path.join(harness.root, BUTTON);
  assert.equal(module!.invalidated.every((file) => file === button), true);
  assert.deepEqual(program!.invalidated, []);
  const [preview] = bodies(harness, "preview-generated");
  assert.deepEqual(preview, {
    kind: "preview-generated",
    revision: 2,
    module: "ui.Button",
    files: [{ path: "src-gen/ui/Button.ts", sha256: sha256("export const button = 2;\n"), sizeBytes: 25 }],
  });
  assert.equal(Buffer.from(readDuringEvent!).toString("utf8"), "export const button = 2;\n");
  assert.equal(harness.session.readPreviewFile("src-gen/ui/Button.ts"), null, "a confirmed preview leaves memory");
  assert.deepEqual(bodies(harness, "preview-confirmed"), [{
    kind: "preview-confirmed", revision: 2, module: "ui.Button", generation: 2, paths: ["src-gen/ui/Button.ts"],
  }]);
  assert.deepEqual(harness.session.inspect().modulePreview, { differences: 0, stoppedModules: [] });
  assert.deepEqual(candidateFolders(harness), [], "no preview or candidate folder stays");
  assert.equal(
    readFileSync(path.join(harness.root, "src-gen/ui/Button.ts"), "utf8"),
    "export const button = 2;\n",
    "only the program request writes the public tree",
  );
  // The measurement helper pairs the preview with the acceptance.
  const summary = summarizePreviewTimings(harness.events);
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0]!.outcome, "preview");
  assert.equal(summary.rows[0]!.confirmed, true);
  assert.equal(summary.previewShare, 1);
  assert.equal(summary.differences, 0);
  assert.equal(summary.timeToPreview!.count, 1);
  assert.equal(summary.timeToAcceptance!.count, 1);
  assert.equal(summary.rows[0]!.previewMs! <= summary.rows[0]!.acceptedMs!, true);
});

// --- A refusal sends the program request at once, with a pending state ----

await withHarness("refused", async (harness) => {
  harness.compiler.moduleSteps.push({ kind: "refused", refusal: "public-shape-changed" });
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Button.ts": "export const button = 3;\nexport const extra = 1;\n" };
  const states: string[] = [];
  harness.session.subscribe((event) => {
    if (event.event.kind === "preview-refused") states.push(harness.session.state.kind);
  });
  const mark = harness.session.inspect().lastSequence;
  harness.save(BUTTON, "package ui;\nclass Button { public static var extra = 1; }\n");
  await harness.session.waitForIdle();
  assert.deepEqual(
    kindsAfter(harness, mark),
    ["inputs-changed", "build-started", "preview-refused", "candidate-generated", "generation-accepted"],
  );
  assert.deepEqual(bodies(harness, "preview-refused"), [{
    kind: "preview-refused", revision: 2, module: "ui.Button", source: "genes", code: "public-shape-changed",
  }]);
  assert.deepEqual(states, ["building"], "a refused edit is pending until the program request publishes it");
  assert.deepEqual(candidateFolders(harness), [], "a refusal leaves no preview file");
}, (options) => ({ ...options, modulePreview: { quietMs: 60_000 } }));

// --- Session refusals ------------------------------------------------------

await withHarness("session-refusals", async (harness) => {
  // A Haxe error in the module request: the program request reports it.
  harness.compiler.moduleSteps.push({ kind: "failed", message: "Button.hx:2: Unknown identifier" });
  harness.compiler.programSteps.push({ fail: "Button.hx:2: Unknown identifier" });
  harness.save(BUTTON, "package ui;\nclass Button { static var v = nope; }\n");
  await harness.session.waitForIdle();
  assert.equal(harness.session.state.kind, "degraded");
  // Two modules in one build.
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Card.ts": "export const card = 4;\n" };
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 4; }\n");
  harness.save(CARD, "package ui;\nclass Card { static var v = 4; }\n");
  await harness.session.waitForIdle();
  // A created module needs a new server: no module request.
  harness.save("src/ui/Badge.hx", "package ui;\nclass Badge {}\n", "created");
  await harness.session.waitForIdle();
  // No report from Genes, and no warm server.
  harness.compiler.moduleSteps.push({ kind: "no-report" }, { kind: "unavailable" });
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 5; }\n");
  await harness.session.waitForIdle();
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 6; }\n");
  await harness.session.waitForIdle();
  assert.deepEqual(
    bodies(harness, "preview-refused").map((refusal) => [refusal.revision, refusal.module, refusal.source, refusal.code]),
    [
      [2, "ui.Button", "session", "compile-failed"],
      [4, null, "session", "several-modules"],
      [5, null, "session", "not-module-edit"],
      [6, "ui.Button", "session", "no-report"],
      [7, "ui.Button", "session", "server-unavailable"],
    ],
  );
  assert.equal(harness.session.state.kind, "ready");
  assert.equal(
    harness.compiler.requests.filter((request) => request.kind === "module").length,
    3,
    "several modules and a created file send no module request",
  );
  assert.deepEqual(candidateFolders(harness), [], "a refusal leaves no preview file");
});

// --- A preview that differs from the program result -----------------------

await withHarness("differs", async (harness) => {
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Button.ts": "export const button = 7;\n" };
  harness.compiler.moduleSteps.push({ kind: "preview", files: { "ui/Button.ts": "export const button = 'stale';\n" } });
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 7; }\n");
  await harness.session.waitForIdle();
  assert.deepEqual(bodies(harness, "preview-corrected"), [{
    kind: "preview-corrected",
    revision: 2,
    module: "ui.Button",
    generation: 2,
    paths: ["src-gen/ui/Button.ts"],
    cause: "differs",
  }]);
  assert.deepEqual(harness.session.inspect().modulePreview, { differences: 1, stoppedModules: ["ui.Button"] });
  // The evidence is kept in the private state folder.
  const evidence = path.join(harness.root, ".genes/dev/preview-evidence");
  const kept = readdirSync(evidence);
  assert.equal(kept.length, 1);
  const folder = path.join(evidence, kept[0]!);
  assert.equal(readFileSync(path.join(folder, "preview/ui/Button.ts"), "utf8"), "export const button = 'stale';\n");
  assert.equal(readFileSync(path.join(folder, "program/ui/Button.ts"), "utf8"), "export const button = 7;\n");
  const record = JSON.parse(readFileSync(path.join(folder, "evidence.json"), "utf8")) as Record<string, JsonValue>;
  assert.equal(record.module, "ui.Button");
  assert.equal(record.revision, 2);
  // Previews of that module stop; other modules keep them.
  const modulesBefore = harness.compiler.requests.filter((request) => request.kind === "module").length;
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Button.ts": "export const button = 8;\n" };
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 8; }\n");
  await harness.session.waitForIdle();
  assert.equal(harness.compiler.requests.filter((request) => request.kind === "module").length, modulesBefore);
  assert.deepEqual(bodies(harness, "preview-refused").map((refusal) => refusal.code), ["previews-stopped"]);
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Card.ts": "export const card = 8;\n" };
  harness.save(CARD, "package ui;\nclass Card { static var v = 8; }\n");
  await harness.session.waitForIdle();
  assert.deepEqual(bodies(harness, "preview-generated").map((preview) => preview.module), ["ui.Button", "ui.Card"]);
});

// --- No build when each changed file has equal content --------------------

await withHarness("equal-content", async (harness) => {
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Button.ts": "export const button = 9;\n" };
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 9; }\n");
  await harness.session.waitForIdle();
  const requests = harness.compiler.requests.length;
  const mark = harness.session.inspect().lastSequence;
  // The same bytes again (an editor save without a change).
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 9; }\n");
  await harness.session.waitForIdle();
  assert.deepEqual(kindsAfter(harness, mark), ["inputs-changed"]);
  assert.equal(harness.compiler.requests.length, requests, "an equal save starts no request");
  assert.equal(harness.session.inspect().newestRevision, 3);
  assert.equal(harness.session.inspect().accepted?.revision, 2);
  // One equal file and one changed file: a build.
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Card.ts": "export const card = 9;\n" };
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 9; }\n");
  harness.save(CARD, "package ui;\nclass Card { static var v = 9; }\n");
  await harness.session.waitForIdle();
  assert.equal(harness.session.inspect().accepted?.revision, 5);
  // A file that no accepted build read yet always builds, even when its
  // bytes did not change.
  harness.save("src/Main.hx", "class Main {}\n");
  await harness.session.waitForIdle();
  assert.equal(harness.session.inspect().accepted?.revision, 6);
});

// --- Delays: the start delay before a module request, the quiet time before the program request

await withHarness("delays", async (harness) => {
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Button.ts": "export const button = 10;\n" };
  const savedAt = Date.now();
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 10; }\n");
  await harness.session.waitForIdle();
  const [module, program] = harness.compiler.requests.slice(-2);
  assert.equal(module!.kind, "module");
  assert.equal(module!.startedAt - savedAt < 300, true, `the module request waited ${module!.startedAt - savedAt} ms`);
  assert.equal(program!.startedAt - savedAt >= 390, true, `the program request started ${program!.startedAt - savedAt} ms after the save`);

  // A save in the quiet time: no program request for the older revision,
  // and the next module request starts after the short start delay.
  const hold = deferred<void>();
  harness.compiler.moduleSteps.push({ kind: "preview" }, { kind: "preview", hold });
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Button.ts": "export const button = 11;\n" };
  const count = harness.compiler.requests.length;
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 11; }\n");
  await new Promise<void>((resolve) => {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.event.kind === "preview-generated") {
        unsubscribe();
        resolve();
      }
    });
  });
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Button.ts": "export const button = 12;\n" };
  const secondSave = Date.now();
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 12; }\n");
  while (harness.compiler.requests.length < count + 2) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const second = harness.compiler.requests[count + 1]!;
  assert.equal(second.kind, "module", "a save in the quiet time sends the next module request, not the program request");
  assert.equal(second.startedAt - secondSave < 300, true, `the second module request waited ${second.startedAt - secondSave} ms`);
  hold.resolve();
  await harness.session.waitForIdle();
  assert.deepEqual(
    harness.compiler.requests.slice(count).map((request) => request.kind),
    ["module", "module", "program"],
  );
  assert.deepEqual(
    bodies(harness, "preview-confirmed").map((confirmed) => confirmed.revision),
    [2, 4],
    "the replaced preview of revision 3 needs no confirmation",
  );
}, (options) => ({ ...options, debounceMs: 400, modulePreview: { quietMs: 400 } }));

/** Resolves at the next event of `kind`. */
function nextEvent(harness: Harness, kind: DevelopmentEventBody<JsonValue>["kind"]): Promise<void> {
  return new Promise<void>((resolve) => {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.event.kind === kind) {
        unsubscribe();
        resolve();
      }
    });
  });
}

// --- Same sources: a later admitted preview of another module -------------
// Review of #267: the preview of Button at revision 2 has wrong bytes; Card
// is saved in the quiet time and previewed at revision 3, which is accepted.
// Button's sources did not change after revision 2, so the difference is a
// Genes defect (`differs`), although the revisions differ.

await withHarness("differs-after-admitted-preview", async (harness) => {
  harness.compiler.tree = {
    "ui/Button.ts": "export const button = 21;\n",
    "ui/Card.ts": "export const card = 21;\n",
  };
  harness.compiler.moduleSteps.push(
    { kind: "preview", files: { "ui/Button.ts": "export const button = 'wrong';\n" } },
    { kind: "preview" },
  );
  const previewed = nextEvent(harness, "preview-generated");
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 21; }\n");
  await previewed;
  harness.save(CARD, "package ui;\nclass Card { static var v = 21; }\n");
  await harness.session.waitForIdle();
  assert.deepEqual(
    bodies(harness, "preview-generated").map((preview) => [preview.revision, preview.module]),
    [[2, "ui.Button"], [3, "ui.Card"]],
  );
  assert.equal(harness.session.inspect().accepted?.revision, 3);
  assert.deepEqual(bodies(harness, "preview-corrected"), [{
    kind: "preview-corrected", revision: 2, module: "ui.Button", generation: 2,
    paths: ["src-gen/ui/Button.ts"], cause: "differs",
  }]);
  assert.deepEqual(bodies(harness, "preview-confirmed").map((confirmed) => confirmed.module), ["ui.Card"]);
  assert.deepEqual(harness.session.inspect().modulePreview, { differences: 1, stoppedModules: ["ui.Button"] });
  assert.equal(readdirSync(path.join(harness.root, ".genes/dev/preview-evidence")).length, 1);
}, (options) => ({ ...options, modulePreview: { quietMs: 300 } }));

// The same, but Card's module request is refused: Card's change reached the
// program request without a proof, so Button's difference is the effect of
// a later edit (`newer-revision`), not counted.
await withHarness("newer-revision-after-refusal", async (harness) => {
  harness.compiler.tree = {
    "ui/Button.ts": "export const button = 22;\n",
    "ui/Card.ts": "export const card = 22;\n",
  };
  harness.compiler.moduleSteps.push(
    { kind: "preview", files: { "ui/Button.ts": "export const button = 'older';\n" } },
    { kind: "refused", refusal: "other-modules-changed" },
  );
  const previewed = nextEvent(harness, "preview-generated");
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 22; }\n");
  await previewed;
  harness.save(CARD, "package ui;\nclass Card { static var v = 22; }\n");
  await harness.session.waitForIdle();
  assert.deepEqual(bodies(harness, "preview-corrected"), [{
    kind: "preview-corrected", revision: 2, module: "ui.Button", generation: 2,
    paths: ["src-gen/ui/Button.ts"], cause: "newer-revision",
  }]);
  assert.deepEqual(harness.session.inspect().modulePreview, { differences: 0, stoppedModules: [] });
  assert.equal(existsSync(path.join(harness.root, ".genes/dev/preview-evidence")), false);
}, (options) => ({ ...options, modulePreview: { quietMs: 300 } }));

// --- A same-revision result that changes another file ----------------------
// Genes proved that the program request changes only Button's files. An
// accepted generation of the same sources that also changes Card's file is
// no confirmation.
await withHarness("other-file-changed", async (harness) => {
  harness.compiler.tree = {
    "ui/Button.ts": "export const button = 23;\n",
    "ui/Card.ts": "export const card = 'also changed';\n",
  };
  harness.compiler.moduleSteps.push({ kind: "preview", files: { "ui/Button.ts": "export const button = 23;\n" } });
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 23; }\n");
  await harness.session.waitForIdle();
  assert.deepEqual(bodies(harness, "preview-confirmed"), []);
  assert.deepEqual(bodies(harness, "preview-corrected"), [{
    kind: "preview-corrected", revision: 2, module: "ui.Button", generation: 2,
    paths: ["src-gen/ui/Card.ts"], cause: "differs",
  }]);
  const evidence = path.join(harness.root, ".genes/dev/preview-evidence");
  const record = JSON.parse(readFileSync(path.join(evidence, readdirSync(evidence)[0]!, "evidence.json"), "utf8")) as {
    readonly otherChangedPaths: readonly string[];
  };
  assert.deepEqual(record.otherChangedPaths, ["src-gen/ui/Card.ts"]);
});

// --- A late preview: a save while the module request runs ------------------
await withHarness("late-preview", async (harness) => {
  const hold = deferred<void>();
  harness.compiler.moduleSteps.push({ kind: "preview", hold }, { kind: "preview" });
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Button.ts": "export const button = 24;\n" };
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 24; }\n");
  while (!harness.compiler.requests.some((request) => request.kind === "module")) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Button.ts": "export const button = 25;\n" };
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 25; }\n");
  hold.resolve();
  await harness.session.waitForIdle();
  // The module request of revision 2 ended after revision 3 arrived: its
  // files may show older text, so it shows no preview.
  assert.deepEqual(bodies(harness, "preview-generated").map((preview) => preview.revision), [3]);
  assert.deepEqual(bodies(harness, "preview-refused"), []);
  assert.deepEqual(
    harness.compiler.requests.slice(1).map((request) => request.kind),
    ["module", "module", "program"],
    "no program request for the older revision",
  );
  assert.deepEqual(bodies(harness, "preview-confirmed").map((confirmed) => confirmed.revision), [3]);
  assert.equal(
    readFileSync(path.join(harness.root, "src-gen/ui/Button.ts"), "utf8"),
    "export const button = 25;\n",
  );
});

// --- A save during the program request, with a pending preview -------------
await withHarness("save-during-program", async (harness) => {
  const started = deferred<void>();
  const hold = deferred<void>();
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Button.ts": "export const button = 26;\n" };
  harness.compiler.programSteps.push({ started, hold });
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 26; }\n");
  await started.promise;
  // The preview of revision 2 is pending; Card's save makes the running
  // program request's candidate stale.
  assert.notEqual(harness.session.readPreviewFile("src-gen/ui/Button.ts"), null);
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Card.ts": "export const card = 26;\n" };
  harness.save(CARD, "package ui;\nclass Card { static var v = 26; }\n");
  hold.resolve();
  await harness.session.waitForIdle();
  assert.equal(
    bodies(harness, "candidate-superseded").some((event) => event.revision === 2),
    true,
    "the candidate of revision 2 is never published",
  );
  assert.equal(harness.session.inspect().accepted?.revision, 3);
  assert.deepEqual(
    bodies(harness, "preview-confirmed").map((confirmed) => [confirmed.revision, confirmed.module, confirmed.generation]),
    [[2, "ui.Button", 2], [3, "ui.Card", 2]],
    "the pending preview survives the stale candidate and is settled by the next accepted generation",
  );
  assert.deepEqual(harness.session.inspect().modulePreview, { differences: 0, stoppedModules: [] });
  assert.equal(harness.session.readPreviewFile("src-gen/ui/Button.ts"), null);
});

// --- prepareRevision with modulePreview ------------------------------------
await withHarness("prepared-inputs", async (harness) => {
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Button.ts": "export const button = 27;\n" };
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 27; }\n");
  await harness.session.waitForIdle();
  const [module, program] = harness.compiler.requests.slice(-2);
  assert.equal(module!.kind, "module");
  assert.equal(program!.kind, "program");
  // The module request gets its own copy of the prepared inputs, with the
  // digest of the program request, so both select the same Haxe cache.
  assert.notEqual(module!.prepared, undefined);
  assert.equal(module!.prepared!.digest, program!.prepared!.digest);
  assert.notDeepEqual(module!.prepared!.classPaths, program!.prepared!.classPaths);
  assert.deepEqual(bodies(harness, "preview-confirmed").map((confirmed) => confirmed.module), ["ui.Button"]);
  assert.deepEqual(candidateFolders(harness), [], "the prepared copy of the module request is removed");
}, (options) => ({
  ...options,
  prepareRevision: () => ({
    ok: true as const,
    prepared: {
      classPaths: ["generated-haxe"],
      files: [{ relativePath: "generated-haxe/Facts.hx", content: "class Facts {}\n" }],
    },
  }),
}));

// --- Equal content after a failed build still builds -----------------------
await withHarness("equal-content-after-failure", async (harness) => {
  harness.compiler.tree = { ...harness.compiler.tree, "ui/Button.ts": "export const button = 28;\n" };
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 28; }\n");
  await harness.session.waitForIdle();
  harness.compiler.programSteps.push({ fail: "Card.hx:1: broken" });
  harness.save(CARD, "package ui;\nclass Card { static var v = broken; }\n");
  await harness.session.waitForIdle();
  assert.equal(harness.session.state.kind, "degraded");
  const requests = harness.compiler.requests.length;
  // Button keeps the bytes of the last accepted build, but the newest
  // revision failed: a save is a retry and builds.
  harness.save(BUTTON, "package ui;\nclass Button { static var v = 28; }\n");
  await harness.session.waitForIdle();
  assert.equal(harness.compiler.requests.length > requests, true, "a save after a failed build must build");
});

// --- The measurement helper on known events -------------------------------

{
  const event = (sequence: number, at: number, body: DevelopmentEventBody<JsonValue>): DevelopmentEvent<JsonValue> => ({
    protocol: "genes.tooling.development-session-event",
    version: 1,
    sequence,
    at,
    event: body,
  });
  const accepted = (generation: number, revision: number) => ({
    generation, revision, acceptedAt: 0, manifestDigest: "a".repeat(64),
    compilerMode: "connected" as const, files: { created: [], updated: [], deleted: [] }, entryChanged: false,
  });
  const summary = summarizePreviewTimings([
    event(1, 1_000, { kind: "inputs-changed", revision: 2, paths: ["src/ui/Button.hx"] }),
    event(2, 1_300, { kind: "preview-generated", revision: 2, module: "ui.Button", files: [] }),
    event(3, 3_000, { kind: "generation-accepted", accepted: accepted(2, 2) }),
    event(4, 3_001, { kind: "preview-confirmed", revision: 2, module: "ui.Button", generation: 2, paths: [] }),
    event(5, 4_000, { kind: "inputs-changed", revision: 3, paths: ["src/ui/Card.hx"] }),
    event(6, 4_200, { kind: "preview-refused", revision: 3, module: "ui.Card", source: "genes", code: "public-shape-changed" }),
    event(7, 6_000, { kind: "generation-accepted", accepted: accepted(3, 3) }),
    event(8, 7_000, { kind: "inputs-changed", revision: 4, paths: ["src/ui/Card.hx"] }),
    event(9, 7_500, { kind: "preview-generated", revision: 4, module: "ui.Card", files: [] }),
    event(10, 9_000, { kind: "generation-accepted", accepted: accepted(4, 4) }),
    event(11, 9_001, { kind: "preview-corrected", revision: 4, module: "ui.Card", generation: 4, paths: [], cause: "differs" }),
  ]);
  assert.deepEqual(summary.rows.map((row) => [row.revision, row.outcome, row.code, row.previewMs, row.acceptedMs, row.confirmed]), [
    [2, "preview", null, 300, 2_000, true],
    [3, "refused", "public-shape-changed", null, 2_000, null],
    [4, "preview", null, 500, 2_000, false],
  ]);
  assert.equal(summary.previews, 2);
  assert.equal(summary.refusals, 1);
  assert.equal(summary.differences, 1);
  assert.deepEqual(summary.timeToPreview, { count: 2, medianMs: 400, p95Ms: 500, maxMs: 500 });
  assert.deepEqual(summary.timeToAcceptance, { count: 3, medianMs: 2_000, p95Ms: 2_000, maxMs: 2_000 });
}

console.log("genes tooling module-first session: passed");
