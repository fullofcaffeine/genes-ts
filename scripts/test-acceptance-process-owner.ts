import { ok, rejects, strictEqual, throws } from "node:assert";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  AcceptanceProcessOwner,
  maxNodeTimerDelayMs,
  terminateAcceptanceProcessTree
} from "./acceptance-process-owner.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const probe = path.join(scriptDir, "acceptance-owner-probe.js");
const reportRoot = path.join(repoRoot, ".tmp/test-acceptance-process-owner");
const processStartupTimeoutMs = 15_000;

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform === "win32") return true;
  const state = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
    encoding: "utf8"
  }).stdout.trim();
  return state.length > 0 && !state.startsWith("Z");
}

async function stopBystander(child: ChildProcess): Promise<void> {
  await terminateAcceptanceProcessTree(child, 500);
}

async function waitForOwnedPids(logPath: string): Promise<ReadonlyArray<number>> {
  const deadline = Date.now() + processStartupTimeoutMs;
  while (Date.now() < deadline) {
    const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    const pids = [...log.matchAll(/probe:(?:parent|child|grandchild):(\d+)/g)]
      .map((match) => Number(match[1]));
    if (pids.length === 3) return pids;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for the owned process tree in ${logPath}`);
}

async function waitForLog(logPath: string, pattern: RegExp): Promise<string> {
  const deadline = Date.now() + processStartupTimeoutMs;
  while (Date.now() < deadline) {
    const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    if (pattern.test(log)) return log;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${String(pattern)} in ${logPath}`);
}

function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number
): Promise<{
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      clearTimeout(timeout);
      resolve({ code, signal });
    };
    const timeout = setTimeout(() => {
      child.removeListener("exit", onExit);
      reject(new Error(`Child ${String(child.pid)} did not exit within ${String(timeoutMs)}ms`));
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

rmSync(reportRoot, { recursive: true, force: true });
throws(
  () => new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: path.join(reportRoot, "invalid-timeout"),
    timeoutMs: maxNodeTimerDelayMs + 1
  }),
  /Acceptance timeout must be an integer from 1 to 2147483647/
);
const bystander = spawn(process.execPath, [probe, "bystander"], {
  cwd: repoRoot,
  detached: process.platform !== "win32",
  stdio: "ignore"
});
ok(bystander.pid !== undefined, "Bystander did not start");

try {
  const timeoutRoot = path.join(reportRoot, "timeout");
  const owner = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: timeoutRoot,
    timeoutMs: 3_000,
    terminationGraceMs: 250
  });
  await rejects(
    owner.run({
      id: "hung-tree",
      command: process.execPath,
      args: [probe, "grandchild"]
    }),
    /Acceptance timed out in hung-tree/
  );

  const log = readFileSync(path.join(timeoutRoot, "hung-tree.log"), "utf8");
  const ownedPids = [...log.matchAll(/probe:(?:parent|child|grandchild):(\d+)/g)]
    .map((match) => Number(match[1]));
  strictEqual(ownedPids.length, 1, `Expected one owned PID, got ${log}`);
  for (const pid of ownedPids) {
    strictEqual(isRunning(pid), false, `Owned process ${String(pid)} survived`);
  }
  strictEqual(
    isRunning(bystander.pid),
    true,
    "Acceptance timeout terminated an unrelated process"
  );

  const timeoutState = JSON.parse(
    readFileSync(path.join(timeoutRoot, "state.json"), "utf8")
  ) as {
    readonly activeGate?: unknown;
    readonly gates?: ReadonlyArray<{ readonly status?: unknown }>;
  };
  strictEqual(timeoutState.activeGate, "hung-tree");
  strictEqual(timeoutState.gates?.[0]?.status, "timed-out");

  if (process.platform !== "win32") {
    const rootExitRoot = path.join(reportRoot, "root-exit");
    const rootExit = new AcceptanceProcessOwner({
      cwd: repoRoot,
      reportRoot: rootExitRoot,
      // This is a normal completion case, not the deliberate timeout probe.
      // Leave enough time for two Node processes to start on a contended host.
      timeoutMs: processStartupTimeoutMs,
      terminationGraceMs: 250
    });
    await rootExit.run({
      id: "background-root",
      command: process.execPath,
      args: [probe, "background-root"]
    });
    const rootExitLog = readFileSync(
      path.join(rootExitRoot, "background-root.log"),
      "utf8"
    );
    const descendant = /probe:grandchild:(\d+)/u.exec(rootExitLog);
    ok(descendant !== null, `Background descendant did not report: ${rootExitLog}`);
    strictEqual(
      isRunning(Number(descendant[1])),
      false,
      "Background descendant survived its root exit"
    );
    const rootExitState = JSON.parse(
      readFileSync(path.join(rootExitRoot, "state.json"), "utf8")
    ) as {
      readonly activeGate?: unknown;
      readonly gates?: ReadonlyArray<{ readonly status?: unknown }>;
    };
    strictEqual(rootExitState.activeGate, null);
    strictEqual(rootExitState.gates?.[0]?.status, "passed");
  }

  if (process.platform !== "win32") {
    const raceRoot = path.join(reportRoot, "root-exit-signal");
    const raceOwner = spawn(
      process.execPath,
      [probe, "root-exit-owner", raceRoot],
      {
        cwd: repoRoot,
        detached: true,
        stdio: "ignore"
      }
    );
    try {
      const logPath = path.join(raceRoot, "root-exit-signal.log");
      const log = await waitForLog(logPath, /acceptance:root-exit root-exit-signal/u);
      const descendant = /probe:grandchild:(\d+)/u.exec(log);
      ok(descendant !== null, `Root-exit race descendant did not report: ${log}`);
      strictEqual(raceOwner.kill("SIGTERM"), true);
      const exit = await waitForChildExit(raceOwner, processStartupTimeoutMs);
      strictEqual(exit.code, 143, `Root-exit race owner exited with ${JSON.stringify(exit)}`);
      strictEqual(exit.signal, null);
      strictEqual(
        isRunning(Number(descendant[1])),
        false,
        "Root-exit race descendant survived interruption"
      );
      const raceState = JSON.parse(
        readFileSync(path.join(raceRoot, "state.json"), "utf8")
      ) as {
        readonly activeGate?: unknown;
        readonly gates?: ReadonlyArray<{ readonly status?: unknown }>;
      };
      strictEqual(raceState.activeGate, "root-exit-signal");
      strictEqual(raceState.gates?.[0]?.status, "interrupted");
    } finally {
      if (raceOwner.exitCode === null && raceOwner.signalCode === null) {
        await terminateAcceptanceProcessTree(raceOwner, 500);
      }
    }
  }

  if (process.platform !== "win32") {
    const signalRoot = path.join(reportRoot, "signal");
    const signalOwner = spawn(
      process.execPath,
      [probe, "owner", signalRoot],
      {
        cwd: repoRoot,
        detached: true,
        stdio: "ignore"
      }
    );
    try {
      const signalPids = await waitForOwnedPids(
        path.join(signalRoot, "signal-tree.log")
      );
      strictEqual(signalOwner.kill("SIGTERM"), true);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      strictEqual(
        signalOwner.kill("SIGTERM"),
        true,
        "Acceptance owner did not retain its handler during cleanup"
      );
      const exit = await waitForChildExit(signalOwner, processStartupTimeoutMs);
      strictEqual(exit.code, 143, `Signal owner exited with ${JSON.stringify(exit)}`);
      strictEqual(exit.signal, null);
      for (const pid of signalPids) {
        strictEqual(
          isRunning(pid),
          false,
          `Signal-owned descendant ${String(pid)} survived`
        );
      }
      const signalState = JSON.parse(
        readFileSync(path.join(signalRoot, "state.json"), "utf8")
      ) as {
        readonly activeGate?: unknown;
        readonly gates?: ReadonlyArray<{ readonly status?: unknown }>;
      };
      strictEqual(signalState.activeGate, "signal-tree");
      strictEqual(signalState.gates?.[0]?.status, "interrupted");
    } finally {
      if (signalOwner.exitCode === null && signalOwner.signalCode === null) {
        await terminateAcceptanceProcessTree(signalOwner, 500);
      }
    }
  }

  const healthyRoot = path.join(reportRoot, "healthy");
  const healthy = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: healthyRoot,
    timeoutMs: processStartupTimeoutMs
  });
  await healthy.run({
    id: "healthy",
    command: process.execPath,
    args: [probe, "healthy"]
  });
  const healthyState = JSON.parse(
    readFileSync(path.join(healthyRoot, "state.json"), "utf8")
  ) as {
    readonly activeGate?: unknown;
    readonly gates?: ReadonlyArray<{ readonly status?: unknown }>;
  };
  strictEqual(healthyState.activeGate, null);
  strictEqual(healthyState.gates?.[0]?.status, "passed");

  const failureRoot = path.join(reportRoot, "failure");
  const failure = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: failureRoot,
    timeoutMs: processStartupTimeoutMs
  });
  await rejects(
    failure.run({
      id: "failure",
      command: process.execPath,
      args: [probe, "failure"]
    }),
    /Acceptance gate failure failed with exit 7/
  );
  const failureState = JSON.parse(
    readFileSync(path.join(failureRoot, "state.json"), "utf8")
  ) as {
    readonly activeGate?: unknown;
    readonly gates?: ReadonlyArray<{ readonly status?: unknown }>;
  };
  strictEqual(failureState.activeGate, "failure");
  strictEqual(failureState.gates?.[0]?.status, "failed");
  ok(
    readFileSync(path.join(failureRoot, "failure.log"), "utf8")
      .includes("probe:failure"),
    "Failed gate log was not retained"
  );

  const logFailureRoot = path.join(reportRoot, "log-failure");
  mkdirSync(path.join(logFailureRoot, "log-failure.log"), { recursive: true });
  const logFailure = new AcceptanceProcessOwner({
    cwd: repoRoot,
    reportRoot: logFailureRoot,
    timeoutMs: 5_000,
    terminationGraceMs: 500
  });
  await rejects(
    logFailure.run({
      id: "log-failure",
      command: process.execPath,
      args: [probe, "parent"]
    }),
    /EISDIR|directory/iu
  );
  const logFailureState = JSON.parse(
    readFileSync(path.join(logFailureRoot, "state.json"), "utf8")
  ) as {
    readonly activeGate?: unknown;
    readonly gates?: ReadonlyArray<{ readonly status?: unknown }>;
  };
  strictEqual(logFailureState.activeGate, "log-failure");
  strictEqual(logFailureState.gates?.[0]?.status, "failed");
  strictEqual(
    isRunning(bystander.pid),
    true,
    "Acceptance log failure terminated an unrelated process"
  );
} finally {
  await stopBystander(bystander);
}

process.stdout.write("acceptance-process-owner:ok\n");
