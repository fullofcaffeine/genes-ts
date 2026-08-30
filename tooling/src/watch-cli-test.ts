import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatWatchEvent,
  loadWatchValidator,
  parseWatchArguments,
  WatchCommandUsageError,
} from "./commands/watch.js";
import type {
  DevelopmentEvent,
  JsonValue,
  ValidationTree,
} from "./session/index.js";

const repositoryRoot = realpathSync.native(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);
const root = realpathSync.native(
  mkdtempSync(path.join(os.tmpdir(), "genes-watch-cli-")),
);
const repositoryTemporaryRoot = path.join(repositoryRoot, ".tmp");
mkdirSync(repositoryTemporaryRoot, { recursive: true });
const watchFixtureRoot = realpathSync.native(
  mkdtempSync(path.join(repositoryTemporaryRoot, "genes-watch-cli-")),
);
const cli = fileURLToPath(new URL("./cli.js", import.meta.url));

function project(name: string): string {
  const directory = path.join(root, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function treeDigest(directory: string): string {
  const hash = createHash("sha256");
  const visit = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const absolute = path.join(current, name);
      const relative = path.relative(directory, absolute).split(path.sep).join("/");
      const stats = statSync(absolute);
      hash.update(relative);
      hash.update("\0");
      if (stats.isDirectory()) {
        visit(absolute);
      } else {
        hash.update(readFileSync(absolute));
      }
      hash.update("\0");
    }
  };
  visit(directory);
  return hash.digest("hex");
}

function validMain(message: string): string {
  return [
    "package;",
    "class Main {",
    "  static function main():Void {",
    `    trace(${JSON.stringify(message)});`,
    "  }",
    "}",
    "",
  ].join("\n");
}

function invalidMain(): string {
  return [
    "package;",
    "class Main {",
    "  static function main():Void {",
    '    trace("broken");',
    "",
  ].join("\n");
}

interface EventWaiter {
  readonly predicate: (event: DevelopmentEvent<JsonValue>) => boolean;
  readonly resolve: (event: DevelopmentEvent<JsonValue>) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

async function portClosed(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

try {
  const parsed = parseWatchArguments(
    [
      "--project-id",
      "plain/example",
      "--hxml",
      "first.hxml",
      "--hxml",
      "second.hxml",
      "--output",
      "src-gen/index.ts",
      "--allow-root",
      "../shared",
      "--lix",
      "--json-lines",
    ],
    root,
  );
  assert.equal(parsed.projectRoot, root);
  assert.deepEqual(parsed.hxmlFiles, ["first.hxml", "second.hxml"]);
  assert.deepEqual(parsed.allowedRoots, ["../shared"]);
  assert.equal(parsed.stateDirectory, ".genes/dev");
  assert.equal(parsed.haxeExecutable, "haxe");
  assert.equal(parsed.useLix, true);
  assert.equal(parsed.jsonLines, true);
  assert.throws(
    () => parseWatchArguments(["--project-id", "missing"], root),
    (error: unknown) =>
      error instanceof WatchCommandUsageError &&
      error.message === "At least one --hxml entry is required.",
  );

  const help = spawnSync(process.execPath, [cli, "watch", "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /genes watch --project-id/u);
  assert.match(help.stdout, /Haxe-only admission/u);
  assert.match(help.stdout, /never starts a framework server/u);

  const validatorRoot = project("validator module");
  const validatorPath = path.join(validatorRoot, "validator.mjs");
  writeFileSync(
    validatorPath,
    [
      "export default {",
      "  policyFacts: { fixture: 'reviewed-validator', revision: 1 },",
      "  async validate() {",
      "    return { ok: false, diagnostic: { code: 'FIXTURE_REJECTED', message: 'fixture rejection' } };",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  const validator = await loadWatchValidator(validatorRoot, "validator.mjs");
  assert.equal(validator.kind, "module");
  assert.equal(validator.label, "validator.mjs");
  const validationTree: ValidationTree = Object.freeze({
    kind: "candidate",
    revision: 1,
    logicalOutputRoot: "src-gen",
    physicalRoot: path.join(validatorRoot, "candidate"),
    entryLogicalPath: "src-gen/index.ts",
    manifestDigest: "a".repeat(64),
    files: Object.freeze([]),
    extraFiles: Object.freeze([]),
    compilerData: Object.freeze([]),
  });
  assert.deepEqual(
    await validator.validate(validationTree, {
      signal: new AbortController().signal,
      recovery: false,
    }),
    {
      ok: false,
      diagnostic: {
        code: "FIXTURE_REJECTED",
        message: "fixture rejection",
      },
    },
  );
  const haxeOnly = await loadWatchValidator(validatorRoot);
  assert.equal(haxeOnly.kind, "haxe-only");
  assert.match(haxeOnly.label, /Haxe-only admission/u);

  const malformedValidator = path.join(validatorRoot, "malformed.mjs");
  writeFileSync(
    malformedValidator,
    "export default { policyFacts: new Date(), async validate() { return { ok: true }; } };\n",
  );
  await assert.rejects(
    loadWatchValidator(validatorRoot, "malformed.mjs"),
    /policyFacts must contain plain objects/u,
  );
  const outsideValidator = path.join(root, "outside-validator.mjs");
  writeFileSync(
    outsideValidator,
    "export default { policyFacts: {}, async validate() { return { ok: true }; } };\n",
  );
  await assert.rejects(
    loadWatchValidator(
      validatorRoot,
      path.relative(validatorRoot, outsideValidator),
    ),
    /must stay inside the project root/u,
  );

  const fixtureRoot = watchFixtureRoot;
  const sourceRoot = path.join(fixtureRoot, "app-src");
  mkdirSync(sourceRoot);
  const haxeLibraries = path.join(fixtureRoot, "haxe_libraries");
  mkdirSync(haxeLibraries);
  cpSync(
    path.join(repositoryRoot, "haxe_libraries/helder.set.hxml"),
    path.join(haxeLibraries, "helder.set.hxml"),
  );
  writeFileSync(
    path.join(haxeLibraries, "genes-ts.hxml"),
    [
      "-lib helder.set",
      path.join(repositoryRoot, "extraParams.hxml"),
      `-cp ${path.join(repositoryRoot, "src")}`,
      "",
    ].join("\n"),
  );
  cpSync(path.join(repositoryRoot, ".haxerc"), path.join(fixtureRoot, ".haxerc"));
  writeFileSync(
    path.join(fixtureRoot, "build.hxml"),
    [
      "-lib genes-ts",
      "--class-path=app-src",
      "--main=Main",
      "--define=js-es=6",
      "--dce=full",
      "",
    ].join("\n"),
  );
  writeFileSync(path.join(fixtureRoot, "package.json"), '{"type":"module"}\n');
  const main = path.join(sourceRoot, "Main.hx");
  writeFileSync(main, invalidMain());

  const child = spawn(
    process.execPath,
    [
      cli,
      "watch",
      "--root",
      fixtureRoot,
      "--project-id",
      "plain-watch-fixture",
      "--hxml",
      "build.hxml",
      "--output",
      "src-gen/index.js",
      "--lix",
      "--json-lines",
    ],
    { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  const events: DevelopmentEvent<JsonValue>[] = [];
  const waiters = new Set<EventWaiter>();
  let stdout = "";
  let stderr = "";
  let streamFailure: Error | undefined;
  const rejectWaiters = (error: Error): void => {
    streamFailure = error;
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    waiters.clear();
  };
  const acceptEvent = (event: DevelopmentEvent<JsonValue>): void => {
    events.push(event);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(event)) continue;
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(event);
    }
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    while (stdout.includes("\n")) {
      const newline = stdout.indexOf("\n");
      const line = stdout.slice(0, newline);
      stdout = stdout.slice(newline + 1);
      if (line.length === 0) continue;
      try {
        const event = JSON.parse(line) as DevelopmentEvent<JsonValue>;
        assert.equal(event.protocol, "genes.tooling.development-session-event");
        assert.equal(event.version, 1);
        acceptEvent(event);
      } catch (error) {
        rejectWaiters(
          new Error(
            `JSON-lines stdout contained an invalid record ${JSON.stringify(line)}: ${String(error)}`,
          ),
        );
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exit = new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>(
    (resolve) => child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  const waitFor = async (
    predicate: (event: DevelopmentEvent<JsonValue>) => boolean,
    label: string,
  ): Promise<DevelopmentEvent<JsonValue>> => {
    if (streamFailure !== undefined) throw streamFailure;
    const existing = events.find(predicate);
    if (existing !== undefined) return existing;
    return await new Promise<DevelopmentEvent<JsonValue>>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(waiter);
        reject(
          new Error(
            `Timed out waiting for ${label}. stderr=${JSON.stringify(stderr)} events=${JSON.stringify(events.slice(-8))}`,
          ),
        );
      }, 180_000);
      const waiter: EventWaiter = { predicate, resolve, reject, timer };
      waiters.add(waiter);
    });
  };

  try {
    const initialFailure = await waitFor(
      (event) =>
        event.event.kind === "failed" &&
        event.event.failure.phase === "compile" &&
        event.event.failure.recoverable,
      "recoverable initial compile failure",
    );
    assert.match(
      JSON.stringify(
        initialFailure.event.kind === "failed"
          ? initialFailure.event.failure.diagnostic
          : null,
      ),
      /Main\.hx/u,
      "the first failure must come from the authored broken source",
    );
    assert.equal(
      events.some(
        (event) =>
          event.event.kind === "state" && event.event.state.kind === "blocked",
      ),
      true,
    );

    writeFileSync(main, validMain("ready-one"));
    const acceptedOne = await waitFor(
      (event) =>
        event.sequence > initialFailure.sequence &&
        event.event.kind === "generation-accepted" &&
        event.event.accepted.generation === 1,
      "first accepted generation",
    );
    const outputRoot = path.join(fixtureRoot, "src-gen");
    const firstDigest = treeDigest(outputRoot);

    writeFileSync(main, invalidMain());
    const laterFailure = await waitFor(
      (event) =>
        event.sequence > acceptedOne.sequence &&
        event.event.kind === "failed" &&
        event.event.failure.phase === "compile" &&
        event.event.failure.retained?.generation === 1,
      "degraded compile failure",
    );
    assert.equal(
      events.some(
        (event) =>
          event.sequence > acceptedOne.sequence &&
          event.sequence <= laterFailure.sequence &&
          event.event.kind === "state" &&
          event.event.state.kind === "degraded",
      ),
      true,
    );
    assert.equal(treeDigest(outputRoot), firstDigest);

    writeFileSync(main, validMain("ready-two"));
    await waitFor(
      (event) =>
        event.sequence > laterFailure.sequence &&
        event.event.kind === "generation-accepted" &&
        event.event.accepted.generation === 2,
      "second accepted generation",
    );
    assert.notEqual(treeDigest(outputRoot), firstDigest);
    const runtime = spawnSync(
      process.execPath,
      [path.join(outputRoot, "index.js")],
      { cwd: fixtureRoot, encoding: "utf8" },
    );
    assert.equal(runtime.status, 0, runtime.stderr);
    assert.match(runtime.stdout, /ready-two/u);

    const started = events.find(
      (event) =>
        event.event.kind === "compiler-lifecycle" &&
        event.event.event.kind === "started",
    );
    assert.notEqual(started, undefined, "the CLI must own one reusable Haxe server");
    assert.equal(
      events.filter(
        (event) =>
          event.event.kind === "compiler-lifecycle" &&
          event.event.event.kind === "started",
      ).length,
      1,
      "all repaired revisions must reuse one owned Haxe server",
    );
    const port =
      started?.event.kind === "compiler-lifecycle" &&
      started.event.event.kind === "started"
        ? started.event.event.endpoint.port
        : -1;
    assert.equal(child.kill("SIGTERM"), true);
    const closed = await exit;
    assert.deepEqual(closed, { code: 143, signal: null });
    assert.match(stderr, /Haxe-only admission \(no host validator\)/u);
    assert.equal(stdout, "", "JSON-lines output must end at a record boundary");
    assert.equal(await portClosed(port), true, "the owned Haxe server port must close");

    const humanStates = events
      .map((event) => formatWatchEvent(event))
      .filter((line): line is string => line !== null);
    for (const state of ["BUILDING", "BLOCKED", "READY", "DEGRADED", "CLOSING", "CLOSED"]) {
      assert.equal(
        humanStates.some((line) => line.startsWith(state)),
        true,
        `human output omitted ${state}`,
      );
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }

  writeFileSync(path.join(fixtureRoot, "fatal.hxml"), "--cmd=echo forbidden\n");
  const fatal = spawnSync(
    process.execPath,
    [
      cli,
      "watch",
      "--root",
      fixtureRoot,
      "--project-id",
      "fatal-watch-fixture",
      "--hxml",
      "fatal.hxml",
      "--output",
      "fatal-gen/index.js",
      "--json-lines",
    ],
    { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(fatal.status, 1, fatal.stderr);
  const fatalEvents = fatal.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DevelopmentEvent<JsonValue>);
  assert.equal(
    fatalEvents.some(
      (event) =>
        event.event.kind === "failed" && !event.event.failure.recoverable,
    ),
    true,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(watchFixtureRoot, { recursive: true, force: true });
}

process.stdout.write("genes-watch-cli:ok\n");
