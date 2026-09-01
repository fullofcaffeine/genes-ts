import { ok, rejects, strictEqual } from "node:assert";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  AcceptanceProcessOwner,
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

rmSync(reportRoot, { recursive: true, force: true });
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
    const signalRoot = path.join(reportRoot, "signal");
    const signalOwner = spawn(
      process.execPath,
      [probe, "owner", signalRoot],
      { cwd: repoRoot, stdio: "ignore" }
    );
    const signalExit = new Promise<{
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }>((resolve) => signalOwner.once("exit", (code, signal) =>
      resolve({ code, signal })
    ));
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
      const exit = await signalExit;
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
        signalOwner.kill("SIGKILL");
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
