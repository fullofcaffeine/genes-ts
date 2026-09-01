import { ok, rejects, strictEqual, throws } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Writable } from "node:stream";
import {
  AcceptanceEvidenceError,
  AcceptanceInterruptedError,
  AcceptanceProcessOwner,
  maxNodeTimerDelayMs,
  terminateAcceptanceProcessTree
} from "./acceptance-process-owner.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const probe = path.join(scriptDir, "acceptance-owner-probe.js");
const processProbe = path.join(scriptDir, "acceptance-process-probe.js");
const reportRoot = path.join(repoRoot, ".tmp/test-acceptance-process-owner");
const processStartupTimeoutMs = 15_000;

class ImmediateSink extends Writable {
  public override _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    callback();
  }
}

class StalledSink extends Writable {
  public override _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    _callback: (error?: Error | null) => void
  ): void {
    // The owner must settle from its deadline, not this callback.
  }
}

class FinalSentinelSink extends Writable {
  public stalled = false;
  public destroyedWith: Error | null = null;

  public constructor(private readonly sentinel: string) {
    super();
  }

  public override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    if (chunk.toString("utf8").includes(this.sentinel)) {
      this.stalled = true;
      return;
    }
    callback();
  }

  public override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void
  ): void {
    this.destroyedWith = error;
    callback(error);
  }
}

class TrackingSink extends Writable {
  private readonly chunks: Buffer[] = [];

  public override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  public bytes(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

async function isRunning(pid: number): Promise<boolean> {
  if (process.platform === "win32") {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  const child = spawn(process.execPath, [processProbe, "--pid", String(pid)], {
    stdio: "ignore"
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, value: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      if (error === null) resolve(value);
      else reject(error);
    };
    const onError = (error: Error): void => finish(error, null);
    const onExit = (value: number | null): void => finish(null, value);
    const timeout = setTimeout(() => {
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.once("error", () => {});
      child.kill("SIGKILL");
      child.unref();
      finish(new Error(`Process probe timed out for ${String(pid)}`), null);
    }, 1_000);
    child.once("error", onError);
    child.once("exit", onExit);
  });
  if (code === 0) return false;
  if (code === 1) return true;
  throw new Error(`Process probe degraded for ${String(pid)}`);
}

async function stopBystander(child: ChildProcess): Promise<void> {
  await terminateAcceptanceProcessTree(child, 500);
}

async function waitForExit(
  child: ChildProcess,
  timeoutMs = processStartupTimeoutMs
): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      error: Error | null,
      code: number | null,
      signal: NodeJS.Signals | null
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      if (error === null) resolve({ code, signal });
      else reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(null, code, signal);
    };
    const onError = (error: Error): void => finish(error, null, null);
    const timeout = setTimeout(() => {
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      void terminateAcceptanceProcessTree(child, 500).catch(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
      }).finally(() => {
        finish(new Error(`Child ${String(child.pid)} did not exit`), null, null);
      });
    }, timeoutMs);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function waitForPath(
  target: string,
  timeoutMs = processStartupTimeoutMs
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (existsSync(target)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${target}`);
}

async function waitUntilStopped(pid: number, timeoutMs = 2_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (!await isRunning(pid)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Process ${String(pid)} remained alive`);
}

async function waitForPids(
  child: ChildProcess,
  pattern: RegExp,
  expected: number,
  onObserved: (pids: ReadonlyArray<number>) => void = () => {},
  timeoutMs = processStartupTimeoutMs
): Promise<ReadonlyArray<number>> {
  const stdout = child.stdout;
  ok(stdout !== null, "Probe stdout is unavailable");
  let output = "";
  const pids = (): ReadonlyArray<number> => [...output.matchAll(pattern)]
    .map((match) => Number(match[1]));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${String(expected)} PIDs: ${output}`));
    }, timeoutMs);
    const inspect = (value: Buffer | string): void => {
      output += Buffer.isBuffer(value) ? value.toString("utf8") : value;
      const found = pids();
      onObserved(found);
      if (found.length < expected) return;
      clearTimeout(timeout);
      stdout.removeListener("data", inspect);
      resolve(found);
    };
    stdout.on("data", inspect);
  });
}

function stateAt(root: string): {
  readonly schemaVersion?: unknown;
  readonly activeGate?: unknown;
  readonly totals?: { readonly observedBytes?: unknown };
  readonly gates?: ReadonlyArray<{
    readonly id?: unknown;
    readonly status?: unknown;
    readonly phase?: unknown;
    readonly exitCode?: unknown;
    readonly signal?: unknown;
    readonly cleanup?: {
      readonly attempted?: unknown;
      readonly succeeded?: unknown;
      readonly error?: unknown;
      readonly probeDegraded?: unknown;
    };
    readonly output?: {
      readonly observedBytes?: unknown;
      readonly retainedBytes?: unknown;
      readonly droppedBytes?: unknown;
      readonly truncated?: unknown;
      readonly drainTimedOut?: unknown;
      readonly consoleBytes?: unknown;
      readonly consoleDroppedBytes?: unknown;
      readonly consoleTruncated?: unknown;
      readonly error?: unknown;
    };
    readonly publication?: {
      readonly log?: unknown;
      readonly error?: unknown;
    };
  }>;
} {
  return JSON.parse(readFileSync(path.join(root, "state.json"), "utf8"));
}

function writerProxy(
  faultOperation?: string,
  fault?: "stall" | "EIO" | "ENOSPC" | "after-write-EIO" | "stdin-close-stall"
): {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
} {
  return {
    command: process.execPath,
    args: [probe, "writer-proxy"],
    env: {
      ...(faultOperation === undefined
        ? {}
        : { PROBE_WRITER_FAULT_OPERATION: faultOperation }),
      ...(fault === undefined ? {} : { PROBE_WRITER_FAULT: fault })
    }
  };
}

rmSync(reportRoot, { recursive: true, force: true });
throws(
  () => new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: path.join(reportRoot, "invalid-timeout"),
    timeoutMs: maxNodeTimerDelayMs + 1
  }),
  /Acceptance timeout must be an integer from 1 to 2147483647/u
);
for (const terminationGraceMs of [0, Number.POSITIVE_INFINITY, maxNodeTimerDelayMs + 1]) {
  throws(
    () => new AcceptanceProcessOwner({
      cwd: repoRoot,
      reportRoot: path.join(reportRoot, "invalid-termination-grace"),
      timeoutMs: 1_000,
      terminationGraceMs
    }),
    /terminationGraceMs must be an integer from 1 to 2147483647/u
  );
}
for (const limits of [
  { processProbeMs: maxNodeTimerDelayMs + 1 },
  { drainMs: maxNodeTimerDelayMs + 1 },
  { consoleWriteMs: maxNodeTimerDelayMs + 1 },
  { logPublicationMs: maxNodeTimerDelayMs + 1 },
  { statePublicationMs: maxNodeTimerDelayMs + 1 }
]) {
  throws(
    () => new AcceptanceProcessOwner({
      cwd: repoRoot,
      reportRoot: path.join(reportRoot, "invalid-timer-limit"),
      timeoutMs: 1_000,
      limits
    }),
    /must not exceed 2147483647/u
  );
}

const bystander = spawn(process.execPath, [probe, "bystander"], {
  cwd: repoRoot,
  detached: process.platform !== "win32",
  stdio: "ignore"
});
ok(bystander.pid !== undefined, "Bystander did not start");

try {
  const preStartTimeoutRoot = path.join(reportRoot, "pre-start-timeout");
  const previousPreStartRun = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: preStartTimeoutRoot,
    timeoutMs: 5_000,
    stdout: new ImmediateSink(),
    stderr: new ImmediateSink(),
    limits: { statePublicationMs: 15_000 }
  });
  await previousPreStartRun.run({
    id: "previous-pre-start-run",
    command: process.execPath,
    args: [probe, "healthy"]
  });
  strictEqual(stateAt(preStartTimeoutRoot).gates?.[0]?.status, "passed");
  const preStartTimeout = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: preStartTimeoutRoot,
    timeoutMs: 1,
    terminationGraceMs: 100,
    limits: { statePublicationMs: 15_000 }
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  await rejects(
    preStartTimeout.run({
      id: "pre-start-timeout",
      command: process.execPath,
      args: [probe, "healthy"]
    }),
    /timed out before pre-start-timeout started/u
  );
  const preStartState = stateAt(preStartTimeoutRoot);
  strictEqual(preStartState.activeGate, "pre-start-timeout");
  strictEqual(preStartState.gates?.length, 1);
  strictEqual(preStartState.gates?.[0]?.id, "pre-start-timeout");
  strictEqual(preStartState.gates?.[0]?.status, "timed-out");
  strictEqual(preStartState.gates?.[0]?.exitCode, null);
  strictEqual(preStartState.gates?.[0]?.cleanup?.attempted, false);

  const awaitedExpiryRoot = path.join(reportRoot, "awaited-pre-start-timeout");
  const awaitedExpiryMarker = path.join(reportRoot, "awaited-pre-start-side-effect");
  const awaitedExpiryWriter = writerProxy();
  const awaitedExpiry = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: awaitedExpiryRoot,
    timeoutMs: 10,
    terminationGraceMs: 100,
    stdout: new ImmediateSink(),
    stderr: new ImmediateSink(),
    evidenceWriter: {
      ...awaitedExpiryWriter,
      env: {
        ...awaitedExpiryWriter.env,
        PROBE_WRITER_LOG_DELAY_MS: "50",
        PROBE_WRITER_MARKER_OPERATION: "reset-report"
      }
    },
    limits: { statePublicationMs: 15_000 }
  });
  await rejects(
    awaitedExpiry.run({
      id: "awaited-pre-start-timeout",
      command: process.execPath,
      args: [probe, "write-side-effect", awaitedExpiryMarker]
    }),
    /timed out before awaited-pre-start-timeout started/u
  );
  strictEqual(existsSync(awaitedExpiryMarker), false, "Expired gate performed a side effect");
  strictEqual(stateAt(awaitedExpiryRoot).gates?.[0]?.status, "timed-out");

  const preStartSignalRoot = path.join(reportRoot, "pre-start-signal");
  const preStartSignalMarker = path.join(reportRoot, "pre-start-signal-publishing");
  const preStartSignalWriter = writerProxy();
  const preStartSignal = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: preStartSignalRoot,
    timeoutMs: 1,
    stdout: new ImmediateSink(),
    stderr: new ImmediateSink(),
    evidenceWriter: {
      ...preStartSignalWriter,
      env: {
        ...preStartSignalWriter.env,
        PROBE_WRITER_LOG_MARKER: preStartSignalMarker,
        PROBE_WRITER_LOG_DELAY_MS: "1000",
        PROBE_WRITER_MARKER_OPERATION: "publish-state",
        PROBE_WRITER_MARKER_PUBLICATION_PHASE: "terminal"
      }
    },
    limits: { statePublicationMs: 15_000 }
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  const preStartSignalRun = preStartSignal.run({
    id: "pre-start-signal",
    command: process.execPath,
    args: [probe, "write-side-effect", awaitedExpiryMarker]
  });
  void preStartSignalRun.catch(() => {});
  await waitForPath(preStartSignalMarker);
  process.emit("SIGTERM");
  await rejects(
    preStartSignalRun,
    (error: unknown) => error instanceof AcceptanceInterruptedError
      && error.exitCode === 143
  );
  strictEqual(stateAt(preStartSignalRoot).gates?.[0]?.status, "interrupted");

  const timeoutRoot = path.join(reportRoot, "timeout");
  const timeoutOwner = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: timeoutRoot,
    timeoutMs: 15_000,
    terminationGraceMs: 100,
    limits: { statePublicationMs: 15_000 }
  });
  await rejects(
    timeoutOwner.run({
      id: "hung-tree",
      command: process.execPath,
      args: [probe, "grandchild"]
    }),
    /Acceptance timed out in hung-tree/u
  );
  const timeoutLog = readFileSync(path.join(timeoutRoot, "hung-tree.log"), "utf8");
  const timedPid = /probe:grandchild:(\d+)/u.exec(timeoutLog);
  ok(timedPid !== null, `Timed tree did not report: ${timeoutLog}`);
  strictEqual(await isRunning(Number(timedPid[1])), false, "Timed process survived");
  strictEqual(await isRunning(bystander.pid), true, "Timeout killed an unrelated process");
  const timeoutState = stateAt(timeoutRoot);
  strictEqual(timeoutState.schemaVersion, 2);
  strictEqual(timeoutState.activeGate, "hung-tree");
  strictEqual(timeoutState.gates?.[0]?.status, "timed-out");
  strictEqual(timeoutState.gates?.[0]?.cleanup?.succeeded, true);

  if (process.platform !== "win32") {
    const provisionalMarker = path.join(reportRoot, "provisional-process-probe.pid");
    const provisionalProbe = spawn(process.execPath, [probe, "resistant-root", provisionalMarker], {
      cwd: repoRoot,
      detached: true,
      stdio: "ignore"
    });
    ok(provisionalProbe.pid !== undefined, "Provisional process probe did not start");
    const provisionalPid = provisionalProbe.pid;
    await waitForPath(provisionalMarker);
    await terminateAcceptanceProcessTree(
      provisionalProbe,
      100,
      100,
      () => {},
      { command: process.execPath, args: [probe, "empty-process-probe"] }
    );
    await waitUntilStopped(provisionalPid);

    const zombieOnlyMarker = path.join(reportRoot, "zombie-only-process-probe.pid");
    const zombieOnlyCount = path.join(reportRoot, "zombie-only-process-probe.count");
    const zombieOnlyProbe = spawn(
      process.execPath,
      [probe, "resistant-root", zombieOnlyMarker],
      { cwd: repoRoot, detached: true, stdio: "ignore" }
    );
    ok(zombieOnlyProbe.pid !== undefined, "Zombie-only process probe did not start");
    const zombieOnlyPid = zombieOnlyProbe.pid;
    await waitForPath(zombieOnlyMarker);
    try {
      await terminateAcceptanceProcessTree(
        zombieOnlyProbe,
        100,
        100,
        () => {},
        {
          command: process.execPath,
          args: [probe, "zombie-only-process-probe"],
          env: { PROBE_PROCESS_COUNT_PATH: zombieOnlyCount }
        }
      );
      const zombieScans = readFileSync(zombieOnlyCount, "utf8")
        .split("\n")
        .filter((line) => line.length > 0);
      ok(zombieScans.length >= 2, "Zombie-only status was trusted after one scan");
    } finally {
      try {
        process.kill(-zombieOnlyPid, "SIGKILL");
      } catch {
        // The injected zombie-only authority already returned.
      }
      await waitUntilStopped(zombieOnlyPid);
    }

    const rootExitRoot = path.join(reportRoot, "root-exit");
    const rootExit = new AcceptanceProcessOwner({
      cwd: repoRoot,
      reportRoot: rootExitRoot,
      timeoutMs: processStartupTimeoutMs,
      terminationGraceMs: 100,
      limits: { statePublicationMs: 15_000 }
    });
    await rootExit.run({
      id: "background-root",
      command: process.execPath,
      args: [probe, "background-root"]
    });
    const log = readFileSync(path.join(rootExitRoot, "background-root.log"), "utf8");
    const descendant = /probe:grandchild:(\d+)/u.exec(log);
    ok(descendant !== null, `Background descendant did not report: ${log}`);
    strictEqual(await isRunning(Number(descendant[1])), false, "Descendant survived root exit");
    strictEqual(stateAt(rootExitRoot).gates?.[0]?.status, "passed");

    const descriptorRoot = path.join(reportRoot, "descriptor-holder");
    const descriptorOwner = new AcceptanceProcessOwner({
      cwd: repoRoot,
      reportRoot: descriptorRoot,
      timeoutMs: processStartupTimeoutMs,
      terminationGraceMs: 100,
      limits: { drainMs: 100, statePublicationMs: 15_000 }
    });
    const descriptorStarted = performance.now();
    await descriptorOwner.run({
      id: "descriptor-holder",
      command: process.execPath,
      args: [probe, "descriptor-root"]
    });
    ok(performance.now() - descriptorStarted < 30_000, "Descriptor drain exceeded its outer bound");
    const descriptorLog = readFileSync(
      path.join(descriptorRoot, "descriptor-holder.log"),
      "utf8"
    );
    const holder = /probe:descriptor-holder:(\d+)/u.exec(descriptorLog);
    ok(holder !== null, `Descriptor holder did not report: ${descriptorLog}`);
    const holderPid = Number(holder[1]);
    strictEqual(await isRunning(holderPid), true, "Owner killed the unrelated descriptor holder");
    strictEqual(
      stateAt(descriptorRoot).gates?.[0]?.output?.drainTimedOut,
      true
    );
    process.kill(holderPid, "SIGKILL");

    const cleanupFailureRoot = path.join(reportRoot, "cleanup-failure");
    const cleanupFailurePidPath = path.join(reportRoot, "cleanup-failure.pid");
    const cleanupFailureOwner = spawn(
      process.execPath,
      [probe, "cleanup-failure-owner", cleanupFailureRoot, "cleanup-survivor"],
      {
        cwd: repoRoot,
        detached: true,
        env: { ...process.env, PROBE_PID_PATH: cleanupFailurePidPath },
        stdio: ["ignore", "pipe", "ignore"]
      }
    );
    let cleanupPids: ReadonlyArray<number> = [];
    try {
      cleanupPids = await waitForPids(
        cleanupFailureOwner,
        /probe:cleanup-survivor:(\d+)/gu,
        1,
        (pids) => { cleanupPids = pids; }
      );
      const cleanupPid = cleanupPids[0];
      ok(cleanupPid !== undefined);
      const exit = await waitForExit(cleanupFailureOwner, 5_000);
      ok(exit.code !== 0 || exit.signal !== null);
      strictEqual(await isRunning(cleanupPid), true);
      const cleanupState = stateAt(cleanupFailureRoot).gates?.[0];
      strictEqual(cleanupState?.status, "failed");
      strictEqual(cleanupState?.cleanup?.attempted, true);
      strictEqual(cleanupState?.cleanup?.succeeded, false);
      ok(String(cleanupState?.cleanup?.error).includes("injected cleanup failure"));
      strictEqual(cleanupState?.exitCode, null);
      strictEqual(cleanupState?.signal, null);
    } finally {
      if (cleanupFailureOwner.exitCode === null && cleanupFailureOwner.signalCode === null) {
        cleanupFailureOwner.kill("SIGKILL");
        cleanupFailureOwner.unref();
      }
      if (existsSync(cleanupFailurePidPath)) {
        const markerPid = Number(readFileSync(cleanupFailurePidPath, "utf8").trim());
        if (Number.isSafeInteger(markerPid) && !cleanupPids.includes(markerPid)) {
          cleanupPids = [...cleanupPids, markerPid];
        }
      }
      for (const cleanupPid of cleanupPids) {
        try {
          process.kill(-cleanupPid, "SIGKILL");
        } catch {
          // The deliberately surviving test process exited independently.
        }
        await waitUntilStopped(cleanupPid);
      }
    }

    const lateExitRoot = path.join(reportRoot, "cleanup-late-exit");
    const lateExitOwner = spawn(
      process.execPath,
      [probe, "cleanup-failure-owner", lateExitRoot, "delayed-exit"],
      { cwd: repoRoot, detached: true, stdio: ["ignore", "pipe", "ignore"] }
    );
    await waitForPids(lateExitOwner, /probe:delayed-exit:(\d+)/gu, 1);
    const lateExit = await waitForExit(lateExitOwner, 5_000);
    ok(lateExit.code !== 0 || lateExit.signal !== null);
    const lateExitState = stateAt(lateExitRoot).gates?.[0];
    strictEqual(lateExitState?.status, "failed");
    strictEqual(lateExitState?.cleanup?.succeeded, false);
    strictEqual(lateExitState?.exitCode, null);
    strictEqual(lateExitState?.signal, null);

    const missingPidRoot = path.join(reportRoot, "cleanup-missing-pid");
    const missingPidPath = path.join(reportRoot, "cleanup-missing-pid.pid");
    const missingPidOwner = spawn(
      process.execPath,
      [probe, "cleanup-failure-owner", missingPidRoot, "cleanup-survivor"],
      {
        cwd: repoRoot,
        detached: true,
        env: {
          ...process.env,
          PROBE_PID_PATH: missingPidPath,
          PROBE_SUPPRESS_PID_OUTPUT: "1"
        },
        stdio: ["ignore", "pipe", "ignore"]
      }
    );
    try {
      await waitForPath(missingPidPath);
      await rejects(
        waitForPids(
          missingPidOwner,
          /probe:cleanup-survivor:(\d+)/gu,
          1,
          () => {},
          100
        ),
        /Timed out waiting for 1 PIDs/u
      );
    } finally {
      if (missingPidOwner.pid !== undefined) {
        try {
          process.kill(-missingPidOwner.pid, "SIGKILL");
        } catch {
          // The detached fixture owner exited independently.
        }
      }
      if (missingPidOwner.exitCode === null && missingPidOwner.signalCode === null) {
        missingPidOwner.kill("SIGKILL");
        missingPidOwner.unref();
      }
      if (existsSync(missingPidPath)) {
        const missingPid = Number(readFileSync(missingPidPath, "utf8").trim());
        try {
          process.kill(-missingPid, "SIGKILL");
        } catch {
          // The deliberately surviving process exited independently.
        }
        await waitUntilStopped(missingPid);
      }
    }

    const failedMarkerRoot = path.join(reportRoot, "cleanup-failed-marker");
    const failedMarkerPath = path.join(reportRoot, "missing-parent", "child.pid");
    const fallbackMarkerPath = path.join(reportRoot, "cleanup-failed-marker.pid");
    const failedMarkerOwner = spawn(
      process.execPath,
      [probe, "cleanup-failure-owner", failedMarkerRoot, "cleanup-survivor"],
      {
        cwd: repoRoot,
        detached: true,
        env: {
          ...process.env,
          PROBE_PID_PATH: failedMarkerPath,
          PROBE_FALLBACK_PID_PATH: fallbackMarkerPath,
          PROBE_SUPPRESS_PID_OUTPUT: "1"
        },
        stdio: ["ignore", "pipe", "ignore"]
      }
    );
    let fallbackPid: number | null = null;
    try {
      await waitForPath(fallbackMarkerPath);
      fallbackPid = Number(readFileSync(fallbackMarkerPath, "utf8").trim());
      await rejects(waitForPath(failedMarkerPath, 100), /Timed out waiting/u);
      const failedMarkerExit = await waitForExit(failedMarkerOwner, 5_000);
      ok(failedMarkerExit.code !== 0 || failedMarkerExit.signal !== null);
      strictEqual(await isRunning(fallbackPid), false);
    } finally {
      if (failedMarkerOwner.pid !== undefined) {
        try {
          process.kill(-failedMarkerOwner.pid, "SIGKILL");
        } catch {
          // The detached fixture owner exited independently.
        }
      }
      if (failedMarkerOwner.exitCode === null && failedMarkerOwner.signalCode === null) {
        failedMarkerOwner.kill("SIGKILL");
        failedMarkerOwner.unref();
      }
      if (fallbackPid !== null) {
        try {
          process.kill(-fallbackPid, "SIGKILL");
        } catch {
          // Real fallback cleanup already removed the child.
        }
        await waitUntilStopped(fallbackPid);
      }
    }
  }

  const capRoot = path.join(reportRoot, "output-cap");
  const capOwner = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: capRoot,
    timeoutMs: processStartupTimeoutMs,
    terminationGraceMs: 100,
    stdout: new ImmediateSink(),
    stderr: new ImmediateSink(),
    limits: {
      retainedBytesPerGate: 1_024,
      consoleBytesPerGate: 2_048,
      observedBytesTotal: 4_096,
      drainMs: 100,
      consoleWriteMs: 100,
      logPublicationMs: 15_000,
      statePublicationMs: 15_000
    }
  });
  await rejects(
    capOwner.run({
      id: "output-cap",
      command: process.execPath,
      args: [probe, "bytes", "8192"]
    }),
    /observed-byte limit/u
  );
  ok(statSync(path.join(capRoot, "output-cap.log")).size <= 1_024);
  const capState = stateAt(capRoot).gates?.[0];
  strictEqual(capState?.status, "failed");
  strictEqual(capState?.output?.truncated, true);
  ok(Number(capState?.output?.droppedBytes) > 0);
  strictEqual(capState?.output?.consoleTruncated, true);
  ok(Number(capState?.output?.consoleDroppedBytes) > 0);

  const aggregateCapRoot = path.join(reportRoot, "aggregate-output-cap");
  const aggregateCapOwner = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: aggregateCapRoot,
    timeoutMs: processStartupTimeoutMs,
    terminationGraceMs: 100,
    stdout: new ImmediateSink(),
    stderr: new ImmediateSink(),
    limits: {
      retainedBytesPerGate: 1_024,
      consoleBytesPerGate: 4_096,
      observedBytesTotal: 3_072,
      drainMs: 100,
      consoleWriteMs: 100,
      logPublicationMs: 15_000,
      statePublicationMs: 15_000
    }
  });
  await aggregateCapOwner.run({
    id: "aggregate-first",
    command: process.execPath,
    args: [probe, "bytes", "1024"]
  });
  await rejects(
    aggregateCapOwner.run({
      id: "aggregate-second",
      command: process.execPath,
      args: [probe, "bytes", "4096"]
    }),
    /observed-byte limit/u
  );
  const aggregateCapState = stateAt(aggregateCapRoot);
  strictEqual(aggregateCapState.gates?.[0]?.status, "passed");
  strictEqual(aggregateCapState.gates?.[1]?.status, "failed");
  ok(Number(aggregateCapState.totals?.observedBytes) > 3_072);

  const preSpawnCapRoot = path.join(reportRoot, "pre-spawn-output-cap");
  const preSpawnSideEffect = path.join(reportRoot, "pre-spawn-side-effect");
  const preSpawnCap = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: preSpawnCapRoot,
    timeoutMs: processStartupTimeoutMs,
    stdout: new ImmediateSink(),
    stderr: new ImmediateSink(),
    limits: {
      retainedBytesPerGate: 1_024,
      consoleBytesPerGate: 4_096,
      observedBytesTotal: 80,
      logPublicationMs: 15_000,
      statePublicationMs: 15_000
    }
  });
  await preSpawnCap.run({
    id: "a",
    command: process.execPath,
    args: [probe, "bytes", "0"]
  });
  await rejects(
    preSpawnCap.run({
      id: "second-gate-with-a-long-start-marker",
      command: process.execPath,
      args: [probe, "write-side-effect", preSpawnSideEffect]
    }),
    /observed-byte limit/u
  );
  strictEqual(existsSync(preSpawnSideEffect), false);
  const preSpawnCapState = stateAt(preSpawnCapRoot);
  strictEqual(preSpawnCapState.gates?.[1]?.status, "failed");
  strictEqual(preSpawnCapState.gates?.[1]?.cleanup?.attempted, false);

  const stalledConsoleRoot = path.join(reportRoot, "stalled-console");
  const stalledConsole = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: stalledConsoleRoot,
    timeoutMs: 5_000,
    terminationGraceMs: 100,
    stdout: new StalledSink(),
    stderr: new ImmediateSink(),
    limits: {
      consoleWriteMs: 50,
      drainMs: 50,
      logPublicationMs: 15_000,
      statePublicationMs: 15_000
    }
  });
  const stalledConsoleStarted = performance.now();
  await rejects(
    stalledConsole.run({
      id: "stalled-console",
      command: process.execPath,
      args: [probe, "parent"]
    }),
    /Console write exceeded 50ms/u
  );
  ok(performance.now() - stalledConsoleStarted < 30_000, "Stalled console escaped its bound");
  strictEqual(stateAt(stalledConsoleRoot).gates?.[0]?.status, "failed");

  const finalWriteRoot = path.join(reportRoot, "final-write");
  const finalSentinel = "probe:final-stalled-write";
  const finalSink = new FinalSentinelSink(finalSentinel);
  const finalWrite = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: finalWriteRoot,
    timeoutMs: 5_000,
    terminationGraceMs: 100,
    stdout: new ImmediateSink(),
    stderr: finalSink,
    limits: {
      consoleWriteMs: 100,
      drainMs: 500,
      logPublicationMs: 15_000,
      statePublicationMs: 15_000
    }
  });
  await rejects(
    finalWrite.run({
      id: "final-write",
      command: process.execPath,
      args: [probe, "final-stderr"]
    }),
    /Console write exceeded 100ms/u
  );
  strictEqual(finalSink.stalled, true);
  ok(finalSink.destroyedWith?.message.includes("Console write exceeded 100ms"));
  ok(readFileSync(path.join(finalWriteRoot, "final-write.log"), "utf8").includes(
    finalSentinel
  ));
  const finalWriteState = stateAt(finalWriteRoot);
  strictEqual(finalWriteState.gates?.[0]?.status, "failed");
  ok(String(finalWriteState.gates?.[0]?.output?.error).includes(
    "Console write exceeded 100ms"
  ));
  const stableFinalState = readFileSync(path.join(finalWriteRoot, "state.json"), "utf8");
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  strictEqual(readFileSync(path.join(finalWriteRoot, "state.json"), "utf8"), stableFinalState);

  const drainBeforeWriteRoot = path.join(reportRoot, "drain-before-write");
  const drainMarker = path.join(reportRoot, "drain-publication-started");
  const drainSink = new FinalSentinelSink(finalSentinel);
  const drainBeforeWrite = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: drainBeforeWriteRoot,
    timeoutMs: 5_000,
    terminationGraceMs: 100,
    stdout: new ImmediateSink(),
    stderr: drainSink,
    evidenceWriter: {
      command: process.execPath,
      args: [probe, "writer-proxy"],
      env: {
        PROBE_WRITER_LOG_MARKER: drainMarker,
        PROBE_WRITER_MARKER_OPERATION: "publish-log"
      }
    },
    limits: {
      consoleWriteMs: 100,
      drainMs: 20,
      logPublicationMs: 15_000,
      statePublicationMs: 15_000
    }
  });
  const drainBeforeWriteStarted = performance.now();
  await rejects(
    drainBeforeWrite.run({
      id: "drain-before-write",
      command: process.execPath,
      args: [probe, "final-stderr"]
    }),
    /Console write exceeded 100ms/u
  );
  ok(performance.now() - drainBeforeWriteStarted >= 80);
  strictEqual(existsSync(drainMarker), true);
  strictEqual(
    stateAt(drainBeforeWriteRoot).gates?.[0]?.output?.drainTimedOut,
    true
  );

  if (process.platform !== "win32") {
    const ordinaryEscalationRoot = path.join(reportRoot, "ordinary-sigkill-escalation");
    const ordinaryEscalationMarker = path.join(reportRoot, "ordinary-sigkill-ready");
    const ordinaryEscalation = new AcceptanceProcessOwner({
      cwd: repoRoot,
      reportRoot: ordinaryEscalationRoot,
      timeoutMs: 500,
      terminationGraceMs: 100,
      stdout: new ImmediateSink(),
      stderr: new ImmediateSink(),
      limits: {
        processProbeMs: 50,
        logPublicationMs: 15_000,
        statePublicationMs: 15_000
      }
    });
    await rejects(
      ordinaryEscalation.run({
        id: "ordinary-sigkill-escalation",
        command: process.execPath,
        args: [probe, "resistant-root", ordinaryEscalationMarker]
      }),
      /Acceptance timed out in ordinary-sigkill-escalation/u
    );
    strictEqual(existsSync(ordinaryEscalationMarker), true);
    const ordinaryEscalationState = stateAt(ordinaryEscalationRoot).gates?.[0];
    strictEqual(ordinaryEscalationState?.cleanup?.succeeded, true);
    strictEqual(ordinaryEscalationState?.cleanup?.probeDegraded, false);

    const stalledProbeRoot = path.join(reportRoot, "stalled-process-probe");
    const stalledProbe = new AcceptanceProcessOwner({
      cwd: repoRoot,
      reportRoot: stalledProbeRoot,
      timeoutMs: 5_000,
      terminationGraceMs: 100,
      stdout: new ImmediateSink(),
      stderr: new ImmediateSink(),
      processProbe: {
        command: process.execPath,
        args: [processProbe],
        env: { GENES_ACCEPTANCE_PROBE_STALL: "1" }
      },
      limits: {
        processProbeMs: 50,
        logPublicationMs: 15_000,
        statePublicationMs: 15_000
      }
    });
    await stalledProbe.run({
      id: "stalled-process-probe",
      command: process.execPath,
      args: [probe, "healthy"]
    });
    const stalledProbeState = stateAt(stalledProbeRoot).gates?.[0];
    strictEqual(stalledProbeState?.status, "passed");
    strictEqual(stalledProbeState?.cleanup?.probeDegraded, true);
  }

  const monotonicRoot = path.join(reportRoot, "monotonic-deadline");
  const originalDateNow = Date.now;
  let fakeWallTime = originalDateNow();
  Date.now = () => {
    fakeWallTime -= 60_000;
    return fakeWallTime;
  };
  try {
    const monotonicOwner = new AcceptanceProcessOwner({
      cwd: repoRoot,
      reportRoot: monotonicRoot,
      timeoutMs: 100,
      terminationGraceMs: 50,
      stdout: new ImmediateSink(),
      stderr: new ImmediateSink(),
      limits: { statePublicationMs: 15_000 }
    });
    await rejects(
      monotonicOwner.run({
        id: "monotonic-deadline",
        command: process.execPath,
        args: [probe, "cleanup-survivor"]
      }),
      /Acceptance timed out (?:before|in) monotonic-deadline/u
    );
  } finally {
    Date.now = originalDateNow;
  }

  const markerBudgetRoot = path.join(reportRoot, "marker-budget");
  const markerSink = new TrackingSink();
  const markerBudget = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: markerBudgetRoot,
    timeoutMs: 5_000,
    stdout: markerSink,
    stderr: markerSink,
    limits: {
      consoleBytesPerGate: 1,
      logPublicationMs: 15_000,
      statePublicationMs: 15_000
    }
  });
  await markerBudget.run({
    id: "marker-budget",
    command: process.execPath,
    args: [probe, "healthy"]
  });
  strictEqual(markerSink.bytes().length, 1);
  strictEqual(markerSink.bytes().includes(Buffer.from("acceptance:passed")), false);
  const markerBudgetState = stateAt(markerBudgetRoot).gates?.[0];
  strictEqual(markerBudgetState?.output?.consoleBytes, 1);
  ok(Number(markerBudgetState?.output?.consoleDroppedBytes) > 0);
  strictEqual(markerBudgetState?.output?.consoleTruncated, true);

  const blockedConsoleRoot = path.join(reportRoot, "blocked-console-pipe");
  const blockedConsole = spawn(
    process.execPath,
    [probe, "blocked-console-owner", blockedConsoleRoot],
    { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] }
  );
  const blockedConsoleStarted = performance.now();
  try {
    const exit = await waitForExit(blockedConsole, 10_000);
    ok(exit.code !== 0 || exit.signal !== null);
    ok(
      performance.now() - blockedConsoleStarted < 10_000,
      "Blocked OS-pipe console write escaped its bound"
    );
    const blockedConsoleState = stateAt(blockedConsoleRoot).gates?.[0];
    strictEqual(blockedConsoleState?.status, "failed");
    strictEqual(blockedConsoleState?.cleanup?.succeeded, true);
    ok(String(blockedConsoleState?.output?.error).includes(
      "Console write exceeded 100ms"
    ));
  } finally {
    blockedConsole.stdout?.destroy();
    if (blockedConsole.exitCode === null && blockedConsole.signalCode === null) {
      await terminateAcceptanceProcessTree(blockedConsole, 500);
    }
  }

  for (const fault of ["EIO", "ENOSPC"] as const) {
    const faultRoot = path.join(reportRoot, `log-${fault.toLowerCase()}`);
    const owner = new AcceptanceProcessOwner({
      cwd: repoRoot,
      reportRoot: faultRoot,
      timeoutMs: 5_000,
      terminationGraceMs: 100,
      evidenceWriter: writerProxy("publish-log", fault),
      limits: { logPublicationMs: 15_000, statePublicationMs: 15_000 }
    });
    await rejects(
      owner.run({
        id: `log-${fault.toLowerCase()}`,
        command: process.execPath,
        args: [probe, "healthy"]
      }),
      new RegExp(fault, "u")
    );
    const state = stateAt(faultRoot).gates?.[0];
    strictEqual(state?.status, "failed");
    strictEqual(state?.publication?.log, "failed");
    ok(String(state?.publication?.error).includes(fault));
  }

  const stalledWriterRoot = path.join(reportRoot, "stalled-writer");
  const stalledWriter = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: stalledWriterRoot,
    timeoutMs: 5_000,
    terminationGraceMs: 100,
    evidenceWriter: writerProxy("publish-log", "stall"),
    limits: { logPublicationMs: 100, statePublicationMs: 15_000 }
  });
  const stalledWriterStarted = performance.now();
  await rejects(
    stalledWriter.run({
      id: "stalled-writer",
      command: process.execPath,
      args: [probe, "healthy"]
    }),
    /publish-log exceeded 100ms/u
  );
  ok(performance.now() - stalledWriterStarted < 30_000, "Stalled writer escaped its bound");

  const stdinFailureRoot = path.join(reportRoot, "writer-stdin-failure");
  const stdinFailurePidPath = path.join(reportRoot, "writer-stdin-failure.pid");
  const stdinFailureWriter = writerProxy("publish-log", "stdin-close-stall");
  const stdinFailure = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: stdinFailureRoot,
    timeoutMs: 5_000,
    terminationGraceMs: 100,
    stdout: new ImmediateSink(),
    stderr: new ImmediateSink(),
    evidenceWriter: {
      ...stdinFailureWriter,
      env: {
        ...stdinFailureWriter.env,
        PROBE_WRITER_PID_PATH: stdinFailurePidPath
      }
    },
    limits: {
      retainedBytesPerGate: 1024 * 1024,
      logPublicationMs: 500,
      statePublicationMs: 15_000
    }
  });
  const stdinFailureStarted = performance.now();
  await rejects(
    stdinFailure.run({
      id: "writer-stdin-failure",
      command: process.execPath,
      args: [probe, "bytes", String(2 * 1024 * 1024)]
    }),
    /EPIPE|closed/u
  );
  ok(performance.now() - stdinFailureStarted < 30_000, "Writer stdin failure escaped its bound");
  const stdinFailurePid = Number(readFileSync(stdinFailurePidPath, "utf8").trim());
  strictEqual(await isRunning(stdinFailurePid), false, "Failed evidence writer survived");

  const stateTimeoutRoot = path.join(reportRoot, "state-timeout");
  const stateTimeout = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: stateTimeoutRoot,
    timeoutMs: 5_000,
    evidenceWriter: writerProxy("reset-report", "stall"),
    limits: { statePublicationMs: 100 }
  });
  const stateTimeoutStarted = performance.now();
  await rejects(
    stateTimeout.run({
      id: "state-timeout",
      command: process.execPath,
      args: [probe, "healthy"]
    }),
    (error: unknown) => error instanceof AcceptanceEvidenceError
      && String(error.cause).includes("reset-report exceeded 100ms")
  );
  ok(performance.now() - stateTimeoutStarted < 30_000, "Stalled state writer escaped its bound");

  const stateFailureRoot = path.join(reportRoot, "state-failure");
  const stateFailure = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: stateFailureRoot,
    timeoutMs: 5_000,
    evidenceWriter: writerProxy("publish-terminal-state", "EIO"),
    limits: { statePublicationMs: 15_000 }
  });
  await rejects(
    stateFailure.run({
      id: "state-failure",
      command: process.execPath,
      args: [probe, "healthy"]
    }),
    (error: unknown) => error instanceof AcceptanceEvidenceError
  );
  const previousState = stateAt(stateFailureRoot);
  strictEqual(previousState.schemaVersion, 2);
  strictEqual(previousState.activeGate, "state-failure");
  strictEqual(previousState.gates?.[0]?.status, "running");

  const completeNewFailureRoot = path.join(reportRoot, "complete-new-state-failure");
  const completeNewFailure = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: completeNewFailureRoot,
    timeoutMs: 5_000,
    stdout: new ImmediateSink(),
    stderr: new ImmediateSink(),
    evidenceWriter: writerProxy("publish-terminal-state", "after-write-EIO"),
    limits: { statePublicationMs: 15_000 }
  });
  await rejects(
    completeNewFailure.run({
      id: "complete-new-state-failure",
      command: process.execPath,
      args: [probe, "healthy"]
    }),
    (error: unknown) => error instanceof AcceptanceEvidenceError
  );
  const completeNewState = stateAt(completeNewFailureRoot);
  strictEqual(completeNewState.activeGate, null);
  strictEqual(completeNewState.gates?.[0]?.phase, "terminal");
  strictEqual(completeNewState.gates?.[0]?.status, "passed");

  if (process.platform !== "win32") {
    const finalSignalRoot = path.join(reportRoot, "signal-final-write");
    const finalSignalMarker = path.join(reportRoot, "signal-final-write-stalled");
    const finalSignalOwner = spawn(
      process.execPath,
      [probe, "signal-final-write-owner", finalSignalRoot, finalSignalMarker],
      { cwd: repoRoot, detached: true, stdio: "ignore" }
    );
    try {
      await waitForPath(finalSignalMarker);
      strictEqual(finalSignalOwner.kill("SIGTERM"), true);
      const exit = await waitForExit(finalSignalOwner, 5_000);
      strictEqual(exit.code, 143);
      const finalSignalState = stateAt(finalSignalRoot).gates?.[0];
      strictEqual(finalSignalState?.status, "interrupted");
      ok(String(finalSignalState?.output?.error).includes(
        "Console write exceeded 300ms"
      ));
    } finally {
      if (finalSignalOwner.exitCode === null && finalSignalOwner.signalCode === null) {
        await terminateAcceptanceProcessTree(finalSignalOwner, 500);
      }
    }

    const signalRoot = path.join(reportRoot, "signal");
    const signalOwner = spawn(process.execPath, [probe, "owner", signalRoot], {
      cwd: repoRoot,
      detached: true,
      stdio: ["ignore", "pipe", "ignore"]
    });
    try {
      const pids = await waitForPids(
        signalOwner,
        /probe:(?:parent|child|grandchild):(\d+)/gu,
        3
      );
      strictEqual(signalOwner.kill("SIGTERM"), true);
      const exit = await waitForExit(signalOwner);
      strictEqual(exit.code, 143);
      for (const pid of pids) strictEqual(await isRunning(pid), false);
      strictEqual(stateAt(signalRoot).gates?.[0]?.status, "interrupted");
    } finally {
      if (signalOwner.exitCode === null && signalOwner.signalCode === null) {
        await terminateAcceptanceProcessTree(signalOwner, 500);
      }
    }

    const outputRoot = path.join(reportRoot, "output-error");
    const outputOwner = spawn(
      process.execPath,
      [probe, "output-error-owner", outputRoot],
      { cwd: repoRoot, detached: true, stdio: ["ignore", "pipe", "ignore"] }
    );
    try {
      const pids = await waitForPids(
        outputOwner,
        /probe:(?:parent|child|grandchild):(\d+)/gu,
        3
      );
      outputOwner.stdout?.destroy();
      const exit = await waitForExit(outputOwner);
      ok(exit.code !== 0 || exit.signal !== null);
      for (const pid of pids) strictEqual(await isRunning(pid), false);
      strictEqual(stateAt(outputRoot).gates?.[0]?.status, "failed");
    } finally {
      if (outputOwner.exitCode === null && outputOwner.signalCode === null) {
        await terminateAcceptanceProcessTree(outputOwner, 500);
      }
    }

    const publicationRoot = path.join(reportRoot, "publication-signal");
    const publicationMarker = path.join(reportRoot, "publication-started");
    const publicationOwner = spawn(
      process.execPath,
      [probe, "publication-signal-owner", publicationRoot, publicationMarker],
      { cwd: repoRoot, detached: true, stdio: "ignore" }
    );
    try {
      await waitForPath(publicationMarker);
      strictEqual(publicationOwner.kill("SIGTERM"), true);
      const exit = await waitForExit(publicationOwner);
      strictEqual(exit.code, 143);
      strictEqual(stateAt(publicationRoot).gates?.[0]?.status, "interrupted");
    } finally {
      if (publicationOwner.exitCode === null && publicationOwner.signalCode === null) {
        await terminateAcceptanceProcessTree(publicationOwner, 500);
      }
    }
  }

  const healthyRoot = path.join(reportRoot, "healthy");
  const healthy = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: healthyRoot,
    timeoutMs: processStartupTimeoutMs,
    stdout: new ImmediateSink(),
    stderr: new ImmediateSink(),
    limits: { statePublicationMs: 15_000 }
  });
  await healthy.run({
    id: "healthy",
    command: process.execPath,
    args: [probe, "bytes", String(512 * 1024)]
  });
  const healthyState = stateAt(healthyRoot);
  strictEqual(healthyState.activeGate, null);
  strictEqual(healthyState.gates?.[0]?.status, "passed");
  strictEqual(healthyState.gates?.[0]?.output?.truncated, false);

  const failureRoot = path.join(reportRoot, "failure");
  const failure = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: failureRoot,
    timeoutMs: processStartupTimeoutMs,
    limits: { statePublicationMs: 15_000 }
  });
  await rejects(
    failure.run({
      id: "failure",
      command: process.execPath,
      args: [probe, "failure"]
    }),
    /Acceptance gate failure failed with exit 7/u
  );
  strictEqual(stateAt(failureRoot).gates?.[0]?.status, "failed");
  ok(readFileSync(path.join(failureRoot, "failure.log"), "utf8").includes("probe:failure"));
} finally {
  await stopBystander(bystander);
}

process.stdout.write("acceptance-process-owner:ok\n");
