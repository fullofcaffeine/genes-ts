/**
 * Tests of the pipe between the development session and its Haxe compile
 * server (`haxe --wait stdio`).
 *
 * Why: the session used to start a Node helper and a `haxe --connect`
 * client process for each build, and Haxe 4.3.7's TCP server sleeps 50 ms
 * when request bytes are late. A request over one open pipe costs about half
 * a millisecond. These tests prove the parts that the session relies on:
 *
 * 1. The answer text is split as the Haxe client splits it.
 * 2. The channel breaks, and never misreads an answer, when a byte arrives
 *    outside a frame, when a frame stays incomplete, or when a frame declares
 *    an impossible length (with a fake server).
 * 3. With a real Haxe server, a request that compiles nothing has a median
 *    of 5 ms or less over 100 requests.
 * 4. Haxe runs its periodic collection right after every tenth request, and
 *    the session's compiler sends requests that compile nothing while the
 *    server is idle, so the count reaches a multiple of ten then.
 * 5. When a macro writes to the server's standard error directly, the
 *    compiler stops that server and builds on a new one; when it happens
 *    again, it builds without a server.
 *
 * Timings are judged only where the acceptance names a bound; they are
 * printed otherwise.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os, { homedir, loadavg } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { HaxeWaitServerEvent } from "./haxe-server/index.js";
import {
  HAXE_4_3_7_DEVELOPMENT_JS_POLICY,
  type BoundHaxeInvocation,
} from "./session/effective-invocation.js";
import { HaxeSessionCompiler } from "./session/haxe-driver.js";
import { launchHaxe } from "./session/haxe-launch.js";
import {
  HAXE_SERVER_COLLECTION_PERIOD,
  HaxeStdioChannel,
  HaxeStdioTransportError,
  decodeHaxeServerAnswer,
} from "./session/haxe-stdio-channel.js";
import { resolveSessionLayout } from "./session/layout.js";

const repositoryRoot = realpathSync.native(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(
  condition: () => boolean,
  what: string,
  timeoutMs = 20_000,
): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    assert.ok(Date.now() - started < timeoutMs, `timed out waiting for ${what}`);
    await sleep(5);
  }
}

function testAnswerDecoding(): void {
  assert.deepEqual(decodeHaxeServerAnswer(""), {
    stdout: "",
    stderr: "",
    failed: false,
  });
  assert.deepEqual(
    decodeHaxeServerAnswer(
      "\u0001hello\u0001world\u0001\nsrc/A.hx:1: characters 1-2 : error\n\u0002\n",
    ),
    {
      stdout: "hello\nworld\n",
      stderr: "src/A.hx:1: characters 1-2 : error\n",
      failed: true,
    },
  );
  // A JSON-RPC answer is a plain message line.
  assert.deepEqual(decodeHaxeServerAnswer('{"result":null}'), {
    stdout: "",
    stderr: '{"result":null}\n',
    failed: false,
  });
}

/**
 * A fake `--wait stdio` server in Node. The first line of each request
 * selects its answer: `ok` (one frame), `split` (one frame in three writes),
 * `noise` (bytes, then a frame), `late` (a frame, then a byte 50 ms later),
 * `stall` (a frame header that declares more bytes than follow), `huge` (an
 * impossible length).
 */
const FAKE_SERVER = String.raw`
let buffer = Buffer.alloc(0);
const frame = (text) => {
  const body = Buffer.from(text);
  const head = Buffer.alloc(4);
  head.writeInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
};
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4 && buffer.length >= 4 + buffer.readInt32LE(0)) {
    const length = buffer.readInt32LE(0);
    const command = buffer.subarray(4, 4 + length).toString().split("\n")[0];
    buffer = buffer.subarray(4 + length);
    const answer = frame("\u0001" + command + "\n");
    if (command === "ok") process.stderr.write(answer);
    else if (command === "split") {
      process.stderr.write(answer.subarray(0, 2));
      setTimeout(() => process.stderr.write(answer.subarray(2, 7)), 20);
      setTimeout(() => process.stderr.write(answer.subarray(7)), 40);
    } else if (command === "noise") process.stderr.write(Buffer.concat([Buffer.from("noise from a macro\n"), answer]));
    else if (command === "late") { process.stderr.write(answer); setTimeout(() => process.stderr.write("x"), 50); }
    else if (command === "stall") process.stderr.write(Buffer.concat([answer.subarray(0, 4), answer.subarray(4, 6)]));
    else if (command === "huge") { const head = Buffer.alloc(4); head.writeInt32LE(0x7fffffff, 0); process.stderr.write(head); }
  }
});
`;

async function withFakeServer(
  run: (channel: HaxeStdioChannel, broken: HaxeStdioTransportError[]) => Promise<void>,
): Promise<void> {
  // No inherited NODE_OPTIONS and no warnings: the fake server's standard
  // error must carry frames only.
  const child = spawn(process.execPath, ["--no-warnings", "-e", FAKE_SERVER], {
    env: {},
    stdio: ["pipe", "ignore", "pipe"],
  });
  const broken: HaxeStdioTransportError[] = [];
  const channel = new HaxeStdioChannel(child.stdin, child.stderr, {
    frameStallMs: 200,
    onBroken: (error) => broken.push(error),
  });
  try {
    await run(channel, broken);
  } finally {
    channel.close();
    child.kill("SIGKILL");
  }
}

async function testFrameErrors(): Promise<void> {
  const text = async (channel: HaxeStdioChannel, command: string): Promise<string> =>
    decodeHaxeServerAnswer((await channel.request([command])).toString()).stdout;

  await withFakeServer(async (channel, broken) => {
    assert.equal(await text(channel, "ok"), "ok");
    assert.equal(await text(channel, "split"), "split");
    assert.equal(channel.requests, 2);
    assert.equal(broken.length, 0);
  });
  await withFakeServer(async (channel, broken) => {
    await assert.rejects(channel.request(["noise"]), HaxeStdioTransportError);
    assert.equal(broken.length, 1);
    // A broken channel refuses every later request without writing it.
    await assert.rejects(channel.request(["ok"]), HaxeStdioTransportError);
    assert.equal(channel.requests, 1);
  });
  await withFakeServer(async (channel, broken) => {
    assert.equal(await text(channel, "late"), "late");
    await waitFor(() => broken.length === 1, "a byte outside a frame");
    assert.match(broken[0]!.message, /outside a frame/u);
    await assert.rejects(channel.request(["ok"]), HaxeStdioTransportError);
  });
  await withFakeServer(async (channel) => {
    await assert.rejects(
      channel.request(["stall"]),
      /stayed incomplete for 200 ms/u,
    );
  });
  await withFakeServer(async (channel) => {
    await assert.rejects(channel.request(["huge"]), /declared 2147483647 bytes/u);
  });
  // One request at a time: a queued request is written after the answer of
  // the earlier one, and a cancelled queued request is never written.
  await withFakeServer(async (channel) => {
    const cancel = new AbortController();
    const first = channel.request(["split"]);
    const cancelled = channel.request(["ok"], cancel.signal);
    const third = channel.request(["ok"]);
    cancel.abort();
    await assert.rejects(cancelled, /cancelled/u);
    assert.equal(decodeHaxeServerAnswer((await first).toString()).stdout, "split");
    assert.equal(decodeHaxeServerAnswer((await third).toString()).stdout, "ok");
    assert.equal(channel.requests, 2);
  });
}

function haxeExecutable(): string {
  const version = execFileSync("haxe", ["--version"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  return process.env.HAXE_STD_PATH === undefined
    ? path.join(homedir(), "haxe", "versions", version, "haxe")
    : path.join(path.dirname(process.env.HAXE_STD_PATH), "haxe");
}

function haxeEnvironment(haxe: string): Readonly<Record<string, string>> {
  const std = path.join(path.dirname(haxe), "std");
  const environment: Record<string, string> = {};
  if (existsSync(std)) environment.HAXE_STD_PATH = std;
  return Object.freeze(environment);
}

/** A two-file program plus a macro that can write to standard error. */
function writeFixture(root: string): void {
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(
    path.join(root, "src", "Main.hx"),
    "class Main {\n  static function main() {\n    trace(Util.greeting());\n  }\n}\n",
  );
  writeFileSync(
    path.join(root, "src", "Util.hx"),
    'class Util {\n  public static function greeting():String {\n    return "hello";\n  }\n}\n',
  );
  // `noise.once` makes the next request write to standard error and is
  // then removed; `noise.always` makes every request write there.
  writeFileSync(
    path.join(root, "src", "Noise.hx"),
    [
      "class Noise {",
      "  public static function run() {",
      '    if (sys.FileSystem.exists("noise.always")) Sys.stderr().writeString("noise from a macro\\n");',
      '    if (sys.FileSystem.exists("noise.once")) {',
      '      sys.FileSystem.deleteFile("noise.once");',
      '      Sys.stderr().writeString("noise from a macro\\n");',
      "    }",
      "  }",
      "}",
      "",
    ].join("\n"),
  );
}

const programArguments = Object.freeze([
  "-cp",
  "src",
  "--macro",
  "Noise.run()",
  "-main",
  "Main",
  "-js",
  "out/main.js",
]);

function invocation(
  haxe: string,
  root: string,
): BoundHaxeInvocation {
  const environment = haxeEnvironment(haxe);
  return Object.freeze({
    sourceInvocation: Object.freeze({
      executable: haxe,
      cwd: root,
      args: Object.freeze(["build.hxml"]),
      ioPolicy: HAXE_4_3_7_DEVELOPMENT_JS_POLICY,
      env: environment,
      compatibilityFacts: Object.freeze({}),
    }),
    executable: haxe,
    cwd: root,
    environment,
    arguments: programArguments,
    privateArgumentFiles: Object.freeze([]),
    requestFiles: Object.freeze([]),
    candidateRoot: path.join(root, "candidate"),
    candidateOutputFile: path.join(root, "candidate", "app.js"),
  });
}

/** Starts `haxe [-v] --wait stdio` through the session's launcher. */
async function startStdioServer(
  haxe: string,
  root: string,
  verbose: boolean,
): Promise<{ child: ChildProcess; channel: HaxeStdioChannel; stdout: () => string }> {
  const launch = launchHaxe(
    haxe,
    [...(verbose ? ["-v"] : []), "--wait", "stdio"],
    {
      cwd: root,
      environment: haxeEnvironment(haxe),
      stdin: "pipe",
      stdout: verbose ? "pipe" : "ignore",
      stderr: "pipe",
    },
  );
  let stdout = "";
  launch.child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  await launch.handoff;
  const channel = new HaxeStdioChannel(launch.child.stdin!, launch.child.stderr!);
  return { child: launch.child, channel, stdout: () => stdout };
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
}

async function testNoOpLatency(haxe: string, root: string): Promise<void> {
  const cwd = realpathSync.native(root);
  const server = await startStdioServer(haxe, root, false);
  try {
    const compile = [`--cwd ${cwd}`, ...programArguments];
    const first = decodeHaxeServerAnswer(
      (await server.channel.request(compile)).toString(),
    );
    assert.equal(first.failed, false, first.stderr);
    const noOp: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      const started = performance.now();
      await server.channel.request([`--cwd ${cwd}`, "-version"]);
      noOp.push(performance.now() - started);
    }
    const small: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now();
      await server.channel.request(compile);
      small.push(performance.now() - started);
    }
    console.log(
      JSON.stringify({
        measure: "stdio-request-latency",
        load: loadavg()[0],
        noOpMedianMs: Number(median(noOp).toFixed(3)),
        noOpMaxMs: Number(Math.max(...noOp).toFixed(3)),
        warmCompileMedianMs: Number(median(small).toFixed(3)),
      }),
    );
    assert.ok(
      median(noOp) <= 5,
      `a request that compiles nothing must have a median of 5 ms or less (${median(noOp)} ms)`,
    );
  } finally {
    server.channel.close();
    await stop(server.child);
  }
}

async function testCollectionTiming(haxe: string, root: string): Promise<void> {
  const cwd = realpathSync.native(root);
  const server = await startStdioServer(haxe, root, true);
  const collections = (): number =>
    (server.stdout().match(/^GC (?:collection|compaction) done/gmu) ?? []).length;
  try {
    for (let index = 1; index < HAXE_SERVER_COLLECTION_PERIOD; index += 1) {
      await server.channel.request([`--cwd ${cwd}`, "-version"]);
    }
    await sleep(200);
    assert.equal(collections(), 0, "no collection before the tenth request");
    await server.channel.request([`--cwd ${cwd}`, "-version"]);
    // The collection runs before the server reads the next request, so the
    // answer of the next request proves it finished.
    const started = performance.now();
    await server.channel.request([`--cwd ${cwd}`, "-version"]);
    const afterCollectionMs = performance.now() - started;
    await waitFor(() => collections() === 1, "the collection after the tenth request");
    console.log(
      JSON.stringify({
        measure: "collection-after-tenth-request",
        load: loadavg()[0],
        nextRequestMs: Number(afterCollectionMs.toFixed(3)),
      }),
    );
  } finally {
    server.channel.close();
    await stop(server.child);
  }
}

async function testSessionCompiler(haxe: string, root: string): Promise<void> {
  const layout = resolveSessionLayout(root, "haxe-stdio-test", "dist/app.js", ".genes/state");
  mkdirSync(path.join(root, path.dirname(layout.serverLeaseRelative)), {
    recursive: true,
  });
  const leasePath = path.join(root, layout.serverLeaseRelative);
  const events: HaxeWaitServerEvent[] = [];
  const compiler = new HaxeSessionCompiler(layout, (event) => events.push(event), 2_000, {
    idleCollectionDelayMs: 20,
  });
  const bound = invocation(haxe, root);
  const compile = async (): Promise<string> =>
    (await compiler.compile(bound, "digest", new AbortController().signal)).mode;
  try {
    assert.equal(await compile(), "connected");
    assert.match(readFileSync(path.join(root, "out", "main.js"), "utf8"), /hello/u);
    const lease = JSON.parse(readFileSync(leasePath, "utf8")) as Record<string, unknown>;
    assert.equal(lease.schema, "genes.tooling.haxe-wait-server-lease.stdio.v1");
    assert.equal("port" in lease, false);
    assert.deepEqual(events, [
      { kind: "started", endpoint: { transport: "stdio", argument: "stdio" } },
    ]);
    const firstPid = compiler.serverRequests!.pid;
    assert.equal(lease.serverPid, firstPid);

    // Idle requests only near the boundary (genes-0emi review): after the
    // readiness request and one compile, 8 requests remain before the tenth,
    // so the compiler sends none and Haxe collects as often as before.
    const idleSettled = async (): Promise<void> => sleep(150);
    await idleSettled();
    assert.deepEqual(compiler.serverRequests, {
      pid: firstPid,
      requests: 2,
      idleRequests: 0,
    });
    // Builds 2 to 5 bring the count to 6: still 4 or more remain, no padding.
    for (let build = 2; build <= 5; build += 1) {
      assert.equal(await compile(), "connected");
      await idleSettled();
    }
    assert.deepEqual(compiler.serverRequests, {
      pid: firstPid,
      requests: 6,
      idleRequests: 0,
    });
    // Build 6 leaves 3 requests before the tenth, fewer than one build may
    // send: the compiler sends them while idle, and Haxe collects then.
    assert.equal(await compile(), "connected");
    await waitFor(
      () => compiler.serverRequests!.requests === HAXE_SERVER_COLLECTION_PERIOD,
      "idle requests up to the collection",
    );
    await idleSettled();
    assert.deepEqual(compiler.serverRequests, {
      pid: firstPid,
      requests: 10,
      idleRequests: 3,
    });
    // A query counts like any request and is followed by the same rule.
    const contexts = await compiler.query("server/contexts");
    assert.match(contexts ?? "", /"result"/u);
    await idleSettled();
    assert.equal(compiler.serverRequests!.requests, 11);

    // A planned replacement (a new compatibility digest each build) and a
    // close stop servers on purpose: no transport-failed (review round 2).
    mkdirSync(path.join(root, ".genes", "replace"), { recursive: true });
    const replaceEvents: HaxeWaitServerEvent[] = [];
    const replacing = new HaxeSessionCompiler(
      resolveSessionLayout(root, "haxe-stdio-test-replace", "dist/replace.js", ".genes/replace"),
      (event) => replaceEvents.push(event),
      2_000,
    );
    try {
      for (let build = 0; build < 4; build += 1) {
        assert.equal(
          (await replacing.compile(bound, `replace-${build}`, new AbortController().signal)).mode,
          "connected",
        );
      }
    } finally {
      await replacing.close();
    }
    await sleep(200);
    assert.equal(replaceEvents.filter((event) => event.kind === "started").length, 4);
    assert.deepEqual(
      replaceEvents.filter((event) => event.kind === "transport-failed"),
      [],
      JSON.stringify(replaceEvents),
    );

    // With idle collection off, the compiler never sends idle requests.
    mkdirSync(path.join(root, ".genes", "quiet"), { recursive: true });
    const quiet = new HaxeSessionCompiler(
      resolveSessionLayout(root, "haxe-stdio-test-quiet", "dist/quiet.js", ".genes/quiet"),
      () => {},
      2_000,
      { idleCollection: false, idleCollectionDelayMs: 1 },
    );
    try {
      for (let build = 0; build < 7; build += 1) {
        assert.equal(
          (await quiet.compile(bound, "quiet", new AbortController().signal)).mode,
          "connected",
        );
      }
      await idleSettled();
      assert.deepEqual(
        { requests: quiet.serverRequests!.requests, idleRequests: quiet.serverRequests!.idleRequests },
        { requests: 8, idleRequests: 0 },
      );
    } finally {
      await quiet.close();
    }

    // A macro writes to standard error once: the compiler stops that server
    // and builds on a new one.
    writeFileSync(path.join(root, "noise.once"), "");
    assert.equal(await compile(), "connected");
    assert.notEqual(compiler.serverRequests!.pid, firstPid);
    const failures = events.filter((event) => event.kind === "transport-failed");
    assert.equal(failures.length, 1, JSON.stringify(events));
    assert.match(
      failures[0]!.kind === "transport-failed" ? failures[0]!.firstBytes : "",
      /^noise from a macro\n/u,
    );
    assert.equal(
      events.filter((event) => event.kind === "started").length,
      2,
      JSON.stringify(events),
    );
    const secondPid = compiler.serverRequests!.pid;
    assert.throws(() => process.kill(firstPid, 0), /ESRCH/u);
    assert.equal(await compile(), "connected");
    assert.equal(compiler.serverRequests!.pid, secondPid);

    // A macro writes to standard error on every request: after the second
    // failure in a row, the compiler builds without a server.
    writeFileSync(path.join(root, "noise.always"), "");
    assert.equal(await compile(), "direct");
    assert.ok(
      events.some(
        (event) => event.kind === "fallback" && event.reason === "server-unresponsive",
      ),
      JSON.stringify(events),
    );
    assert.equal(compiler.serverRequests, null);
    assert.equal(existsSync(leasePath), false);
  } finally {
    await compiler.close();
  }
  assert.equal(compiler.serverRequests, null);
}

async function main(): Promise<void> {
  testAnswerDecoding();
  await testFrameErrors();
  const haxe = haxeExecutable();
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "genes-haxe-stdio-")));
  try {
    writeFixture(root);
    await testNoOpLatency(haxe, root);
    await testCollectionTiming(haxe, root);
    await testSessionCompiler(haxe, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log("genes tooling Haxe stdio channel: ok");
}

await main();
