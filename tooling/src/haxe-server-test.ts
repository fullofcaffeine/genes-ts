import assert from "node:assert/strict";
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

import {
  OwnedHaxeWaitServer,
  reserveLoopbackEndpoint,
  type HaxeWaitEndpoint,
  type HaxeWaitProcessExit,
  type HaxeWaitServerEvent,
  type OwnedHaxeWaitProcess,
} from "./haxe-server/index.js";

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      assert.notEqual(resolvePromise, null);
      resolvePromise!(value);
    },
  };
}

class FakeProcess implements OwnedHaxeWaitProcess {
  readonly pid: number;
  readonly exit: Promise<HaxeWaitProcessExit>;
  readonly signals: Array<"SIGTERM" | "SIGKILL"> = [];
  readonly #exit;
  readonly #exitOnSignal: boolean;
  #settled = false;

  constructor(pid: number, exitOnSignal = true) {
    this.pid = pid;
    this.#exitOnSignal = exitOnSignal;
    this.#exit = deferred<HaxeWaitProcessExit>();
    this.exit = this.#exit.promise;
  }

  signal(signal: "SIGTERM" | "SIGKILL"): void {
    this.signals.push(signal);
    if (this.#exitOnSignal) {
      this.finish({ code: null, signal });
    }
  }

  finish(exit: HaxeWaitProcessExit): void {
    if (!this.#settled) {
      this.#settled = true;
      this.#exit.resolve(Object.freeze(exit));
    }
  }
}

function endpoint(port: number): HaxeWaitEndpoint {
  return Object.freeze({
    host: "127.0.0.1",
    port,
    argument: `127.0.0.1:${port}`,
  });
}

function leaseBytes(
  projectIdentity: string,
  compatibilityDigest: string,
  ownerPid: number,
  serverPid: number,
  port: number,
): string {
  return `${JSON.stringify({
    compatibilityDigest,
    host: "127.0.0.1",
    ownerPid,
    port,
    projectIdentity,
    schema: "genes.tooling.haxe-wait-server-lease.v1",
    serverPid,
  })}\n`;
}

async function main(): Promise<void> {
  const reserved = await reserveLoopbackEndpoint();
  assert.equal(reserved.host, "127.0.0.1");
  assert.equal(reserved.argument, `127.0.0.1:${reserved.port}`);

  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-haxe-server-")),
  );
  try {
    mkdirSync(path.join(root, "state"));
    const leasePath = path.join(root, "state", "server.json");
    const events: HaxeWaitServerEvent[] = [];
    const processes: FakeProcess[] = [];
    let nextPort = 7100;
    let connectedCompiles = 0;
    let directCompiles = 0;
    let probeReady = true;
    let connectedFailure: Error | null = null;
    const server = new OwnedHaxeWaitServer<string>({
      projectRoot: root,
      leasePath: "state/server.json",
      projectIdentity: "project-a",
      ownerPid: 41,
      isProcessAlive: (pid) => pid === 999,
      reserveEndpoint: async () => endpoint(nextPort++),
      start: async () => {
        const processHandle = new FakeProcess(100 + processes.length);
        processes.push(processHandle);
        return processHandle;
      },
      probe: async () => probeReady,
      compileConnected: async () => {
        connectedCompiles += 1;
        if (connectedFailure !== null) {
          throw connectedFailure;
        }
        return "connected";
      },
      compileDirect: async () => {
        directCompiles += 1;
        return "direct";
      },
      onEvent: (event) => events.push(event),
      readinessTimeoutMs: 40,
      probeIntervalMs: 1,
      shutdownTimeoutMs: 5,
    });

    assert.deepEqual(await server.ensure("digest-a"), {
      mode: "connected",
      newlyStarted: true,
    });
    assert.equal(
      readFileSync(leasePath, "utf8"),
      leaseBytes("project-a", "digest-a", 41, 100, 7100),
    );
    assert.deepEqual(await server.ensure("digest-a"), {
      mode: "connected",
      newlyStarted: false,
    });
    assert.equal(processes.length, 1);
    assert.equal(await server.compile("digest-a"), "connected");
    assert.equal(connectedCompiles, 1);

    assert.deepEqual(await server.ensure("digest-b"), {
      mode: "connected",
      newlyStarted: true,
    });
    assert.deepEqual(processes[0]!.signals, ["SIGTERM"]);
    assert.equal(processes.length, 2);

    connectedFailure = new Error("source compile failed");
    probeReady = true;
    await assert.rejects(server.compile("digest-b"), /source compile failed/u);
    probeReady = false;
    assert.equal(await server.compile("digest-b"), "direct");
    assert.deepEqual(processes[1]!.signals, ["SIGTERM"]);
    assert.equal(directCompiles, 1);

    assert.deepEqual(await server.ensure("digest-b"), {
      mode: "direct",
      newlyStarted: false,
    });
    assert.equal(processes.length, 2);
    await server.close();
    assert.deepEqual(await server.ensure("digest-c"), {
      mode: "direct",
      newlyStarted: false,
    });
    await server.close();
    assert.equal(
      events.some(
        (event) =>
          event.kind === "fallback" &&
          event.reason === "server-unresponsive",
      ),
      true,
    );

    const liveRoot = path.join(root, "live");
    mkdirSync(liveRoot);
    const liveLease = path.join(liveRoot, "lease.json");
    writeFileSync(
      liveLease,
      leaseBytes("project-live", "digest", 998, 888, 7200),
      "utf8",
    );
    let liveStarts = 0;
    const liveServer = new OwnedHaxeWaitServer<void>({
      projectRoot: root,
      leasePath: "live/lease.json",
      projectIdentity: "project-live",
      ownerPid: 42,
      isProcessAlive: (pid) => pid === 888,
      start: async () => {
        liveStarts += 1;
        return new FakeProcess(300);
      },
      probe: async () => true,
      compileConnected: async () => {},
      compileDirect: async () => {},
    });
    assert.equal((await liveServer.ensure("digest")).mode, "direct");
    assert.equal(liveStarts, 0);
    assert.equal(
      readFileSync(liveLease, "utf8"),
      leaseBytes("project-live", "digest", 998, 888, 7200),
    );

    writeFileSync(liveLease, "{not-canonical}\n", "utf8");
    const malformedServer = new OwnedHaxeWaitServer<void>({
      projectRoot: root,
      leasePath: "live/lease.json",
      projectIdentity: "project-live",
      ownerPid: 42,
      isProcessAlive: () => false,
      start: async () => new FakeProcess(301),
      probe: async () => true,
      compileConnected: async () => {},
      compileDirect: async () => {},
    });
    assert.equal((await malformedServer.ensure("digest")).mode, "direct");
    assert.equal(readFileSync(liveLease, "utf8"), "{not-canonical}\n");

    writeFileSync(
      liveLease,
      leaseBytes("project-live", "old", 998, 887, 7201),
      "utf8",
    );
    const staleProcess = new FakeProcess(302);
    const staleServer = new OwnedHaxeWaitServer<void>({
      projectRoot: root,
      leasePath: "live/lease.json",
      projectIdentity: "project-live",
      ownerPid: 42,
      isProcessAlive: () => false,
      reserveEndpoint: async () => endpoint(7202),
      start: async () => staleProcess,
      probe: async () => true,
      compileConnected: async () => {},
      compileDirect: async () => {},
      shutdownTimeoutMs: 5,
    });
    assert.equal((await staleServer.ensure("new")).mode, "connected");
    writeFileSync(liveLease, "replacement-owner\n", "utf8");
    await staleServer.close();
    assert.equal(readFileSync(liveLease, "utf8"), "replacement-owner\n");

    const failuresRoot = path.join(root, "failures");
    mkdirSync(failuresRoot);
    const fallbackEvents: HaxeWaitServerEvent[] = [];
    const reservationFailure = new OwnedHaxeWaitServer<void>({
      projectRoot: root,
      leasePath: "failures/reserve.json",
      projectIdentity: "reserve",
      ownerPid: 43,
      isProcessAlive: () => false,
      reserveEndpoint: async () => {
        throw new Error("no port");
      },
      start: async () => new FakeProcess(400),
      probe: async () => true,
      compileConnected: async () => {},
      compileDirect: async () => {},
      onEvent: (event) => fallbackEvents.push(event),
    });
    assert.equal((await reservationFailure.ensure("digest")).mode, "direct");

    const timeoutProcess = new FakeProcess(401);
    const timeoutServer = new OwnedHaxeWaitServer<void>({
      projectRoot: root,
      leasePath: "failures/timeout.json",
      projectIdentity: "timeout",
      ownerPid: 44,
      isProcessAlive: () => false,
      reserveEndpoint: async () => endpoint(7300),
      start: async () => timeoutProcess,
      probe: async () => false,
      compileConnected: async () => {},
      compileDirect: async () => {},
      onEvent: (event) => fallbackEvents.push(event),
      readinessTimeoutMs: 5,
      probeIntervalMs: 1,
      shutdownTimeoutMs: 5,
    });
    assert.equal((await timeoutServer.ensure("digest")).mode, "direct");
    assert.deepEqual(timeoutProcess.signals, ["SIGTERM"]);

    const collisionLease = path.join(failuresRoot, "collision.json");
    const collisionProcess = new FakeProcess(404);
    const collisionServer = new OwnedHaxeWaitServer<void>({
      projectRoot: root,
      leasePath: "failures/collision.json",
      projectIdentity: "collision",
      ownerPid: 47,
      isProcessAlive: () => false,
      reserveEndpoint: async () => endpoint(7303),
      start: async () => collisionProcess,
      probe: async () => {
        writeFileSync(collisionLease, "foreign-owner\n", {
          encoding: "utf8",
          flag: "wx",
        });
        return true;
      },
      compileConnected: async () => {},
      compileDirect: async () => {},
      onEvent: (event) => fallbackEvents.push(event),
      shutdownTimeoutMs: 5,
    });
    assert.equal((await collisionServer.ensure("digest")).mode, "direct");
    assert.equal(readFileSync(collisionLease, "utf8"), "foreign-owner\n");
    assert.deepEqual(collisionProcess.signals, ["SIGTERM"]);

    const earlyProcess = new FakeProcess(402);
    const earlyServer = new OwnedHaxeWaitServer<void>({
      projectRoot: root,
      leasePath: "failures/early.json",
      projectIdentity: "early",
      ownerPid: 45,
      isProcessAlive: () => false,
      reserveEndpoint: async () => endpoint(7301),
      start: async () => {
        queueMicrotask(() =>
          earlyProcess.finish({ code: 1, signal: null }),
        );
        return earlyProcess;
      },
      probe: async () => false,
      compileConnected: async () => {},
      compileDirect: async () => {},
      onEvent: (event) => fallbackEvents.push(event),
      readinessTimeoutMs: 20,
      probeIntervalMs: 1,
      shutdownTimeoutMs: 5,
    });
    assert.equal((await earlyServer.ensure("digest")).mode, "direct");

    const stubborn = new FakeProcess(403, false);
    const stubbornServer = new OwnedHaxeWaitServer<void>({
      projectRoot: root,
      leasePath: "failures/stubborn.json",
      projectIdentity: "stubborn",
      ownerPid: 46,
      isProcessAlive: () => false,
      reserveEndpoint: async () => endpoint(7302),
      start: async () => stubborn,
      probe: async () => true,
      compileConnected: async () => {},
      compileDirect: async () => {},
      onEvent: (event) => fallbackEvents.push(event),
      shutdownTimeoutMs: 2,
    });
    assert.equal((await stubbornServer.ensure("digest")).mode, "connected");
    assert.equal((await stubbornServer.ensure("changed")).mode, "direct");
    assert.equal(existsSync(path.join(failuresRoot, "stubborn.json")), true);
    await stubbornServer.close();
    assert.deepEqual(stubborn.signals, ["SIGTERM", "SIGKILL"]);
    assert.equal(existsSync(path.join(failuresRoot, "stubborn.json")), true);

    const restartProcesses: FakeProcess[] = [];
    const restartServer = new OwnedHaxeWaitServer<void>({
      projectRoot: root,
      leasePath: "failures/restart.json",
      projectIdentity: "restart",
      ownerPid: 48,
      isProcessAlive: () => false,
      reserveEndpoint: async () => endpoint(7400 + restartProcesses.length),
      start: async () => {
        const processHandle = new FakeProcess(500 + restartProcesses.length);
        restartProcesses.push(processHandle);
        return processHandle;
      },
      probe: async () => true,
      compileConnected: async () => {},
      compileDirect: async () => {},
      onEvent: (event) => fallbackEvents.push(event),
      shutdownTimeoutMs: 5,
    });
    assert.equal((await restartServer.ensure("digest")).mode, "connected");
    restartProcesses[0]!.finish({ code: 1, signal: null });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal((await restartServer.ensure("digest")).mode, "connected");
    assert.equal(restartProcesses.length, 2);
    await restartServer.close();

    let concurrentStarts = 0;
    const concurrentServer = new OwnedHaxeWaitServer<void>({
      projectRoot: root,
      leasePath: "failures/concurrent.json",
      projectIdentity: "concurrent",
      ownerPid: 49,
      isProcessAlive: () => false,
      reserveEndpoint: async () => endpoint(7500),
      start: async () => {
        concurrentStarts += 1;
        return new FakeProcess(600);
      },
      probe: async () => true,
      compileConnected: async () => {},
      compileDirect: async () => {},
      shutdownTimeoutMs: 5,
    });
    const concurrent = await Promise.all([
      concurrentServer.ensure("digest"),
      concurrentServer.ensure("digest"),
    ]);
    assert.deepEqual(concurrent, [
      { mode: "connected", newlyStarted: true },
      { mode: "connected", newlyStarted: false },
    ]);
    assert.equal(concurrentStarts, 1);
    await concurrentServer.close();

    for (const reason of [
      "port-reservation-failed",
      "readiness-timeout",
      "startup-exit",
      "lease-write-failed",
      "shutdown-timeout",
    ]) {
      assert.equal(
        fallbackEvents.some(
          (event) => event.kind === "fallback" && event.reason === reason,
        ),
        true,
        `missing fallback event: ${reason}`,
      );
    }

    assert.throws(
      () =>
        new OwnedHaxeWaitServer<void>({
          projectRoot: root,
          leasePath: "../escape.json",
          projectIdentity: "escape",
          ownerPid: 1,
          isProcessAlive: () => false,
          start: async () => new FakeProcess(500),
          probe: async () => true,
          compileConnected: async () => {},
          compileDirect: async () => {},
        }),
      /leasePath/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log("genes tooling owned Haxe wait server: ok");
}

await main();
