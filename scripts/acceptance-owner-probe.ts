import { spawn } from "node:child_process";
import { appendFileSync, closeSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import {
  AcceptanceInterruptedError,
  AcceptanceProcessOwner,
  terminateAcceptanceProcessTree
} from "./acceptance-process-owner.js";

const script = fileURLToPath(import.meta.url);
const mode = process.argv[2];

class SignalledStalledSink extends Writable {
  public constructor(
    private readonly sentinel: string,
    private readonly marker: string
  ) {
    super();
  }

  public override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    if (chunk.toString("utf8").includes(this.sentinel)) {
      writeFileSync(this.marker, "stalled\n");
      return;
    }
    callback();
  }

  public override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void
  ): void {
    callback(error);
  }
}

class FailAfterSentinelSink extends Writable {
  public constructor(private readonly sentinel: string) {
    super();
  }

  public override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    process.stdout.write(chunk);
    callback(chunk.toString("utf8").includes(this.sentinel)
      ? new Error("injected output failure")
      : null);
  }
}

function stayAlive(): void {
  setInterval(() => {}, 60_000);
}

function resistGracefulTermination(): void {
  process.on("SIGTERM", () => {
    // Keep the tree alive until the owner proves its SIGKILL escalation.
  });
}

function descendantIsDetached(): boolean {
  return process.platform !== "win32"
    && process.env.GENES_ACCEPTANCE_PROCESS_OWNER !== "1";
}

function spawnOwnedDescendant(modeName: "child" | "grandchild"): void {
  spawn(process.execPath, [script, modeName], {
    stdio: "inherit",
    detached: descendantIsDetached()
  });
}

async function runOwner(
  reportRoot: string,
  gateId: string,
  probeMode: string,
  evidenceWriter?: {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly env?: NodeJS.ProcessEnv;
  }
): Promise<void> {
  const owner = new AcceptanceProcessOwner({
    cwd: process.cwd(),
    reportRoot,
    timeoutMs: 60_000,
    terminationGraceMs: 500,
    limits: { statePublicationMs: 15_000 },
    evidenceWriter
  });
  try {
    await owner.run({
      id: gateId,
      command: process.execPath,
      args: [script, probeMode]
    });
  } catch (error: unknown) {
    if (error instanceof AcceptanceInterruptedError) {
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  }
}

switch (mode) {
  case "healthy":
    process.stdout.write("probe:healthy\n");
    break;
  case "failure":
    process.stderr.write("probe:failure\n");
    process.exitCode = 7;
    break;
  case "final-stderr":
    process.stderr.write("probe:final-stalled-write\n");
    break;
  case "write-side-effect": {
    const marker = process.argv[3];
    if (marker === undefined) throw new Error("Side-effect probe requires a marker path");
    writeFileSync(marker, "started\n");
    break;
  }
  case "cleanup-survivor":
    if (process.env.PROBE_SUPPRESS_PID_OUTPUT !== "1") {
      process.stdout.write(`probe:cleanup-survivor:${String(process.pid)}\n`);
    }
    stayAlive();
    break;
  case "delayed-exit":
    process.stdout.write(`probe:delayed-exit:${String(process.pid)}\n`);
    setTimeout(() => process.exit(0), Number(process.argv[3] ?? "150"));
    break;
  case "bystander":
    stayAlive();
    break;
  case "resistant-root": {
    const marker = process.argv[3];
    if (marker === undefined) throw new Error("Resistant root requires a marker path");
    resistGracefulTermination();
    writeFileSync(marker, `${String(process.pid)}\n`);
    stayAlive();
    break;
  }
  case "grandchild":
    process.stdout.write(`probe:grandchild:${String(process.pid)}\n`);
    resistGracefulTermination();
    stayAlive();
    break;
  case "child":
    process.stdout.write(`probe:child:${String(process.pid)}\n`);
    resistGracefulTermination();
    spawnOwnedDescendant("grandchild");
    stayAlive();
    break;
  case "parent":
    process.stdout.write(`probe:parent:${String(process.pid)}\n`);
    resistGracefulTermination();
    spawnOwnedDescendant("child");
    stayAlive();
    break;
  case "noisy-parent":
    process.stdout.write(`probe:parent:${String(process.pid)}\n`);
    resistGracefulTermination();
    spawnOwnedDescendant("child");
    setInterval(() => process.stdout.write("probe:tick\n"), 25);
    break;
  case "bytes": {
    const count = Number(process.argv[3] ?? "0");
    process.stdout.write(Buffer.alloc(count, 0x78));
    break;
  }
  case "background-child":
    process.stdout.write(`probe:grandchild:${String(process.pid)}\n`);
    process.send?.("ready");
    resistGracefulTermination();
    stayAlive();
    break;
  case "background-root": {
    process.stdout.write(`probe:parent:${String(process.pid)}\n`);
    const child = spawn(process.execPath, [script, "background-child"], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      detached: descendantIsDetached()
    });
    await new Promise<void>((resolve, reject) => {
      child.once("message", () => {
        child.disconnect();
        child.unref();
        resolve();
      });
      child.once("error", reject);
    });
    break;
  }
  case "descriptor-holder":
    process.stdout.write(`probe:descriptor-holder:${String(process.pid)}\n`);
    process.send?.("ready");
    if (Number(process.argv[3] ?? "0") > 0) {
      setTimeout(() => process.exit(0), Number(process.argv[3]));
    } else {
      stayAlive();
    }
    break;
  case "descriptor-root": {
    const holder = spawn(
      process.execPath,
      [script, "descriptor-holder", process.argv[3] ?? "0"],
      {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      detached: process.platform !== "win32"
      }
    );
    await new Promise<void>((resolve, reject) => {
      holder.once("message", () => {
        holder.disconnect();
        holder.unref();
        resolve();
      });
      holder.once("error", reject);
    });
    break;
  }
  case "writer-proxy": {
    const operation = process.argv[3];
    const faultOperation = process.env.PROBE_WRITER_FAULT_OPERATION;
    const fault = process.env.PROBE_WRITER_FAULT;
    const publicationPhase = process.argv[5] ?? "";
    const terminalStateFault = faultOperation === "publish-terminal-state"
      && operation === "publish-state"
      && publicationPhase === "terminal";
    const operationFault = faultOperation === operation;
    if ((operationFault || terminalStateFault) && fault === "stdin-close-stall") {
      const pidPath = process.env.PROBE_WRITER_PID_PATH;
      if (pidPath !== undefined) writeFileSync(pidPath, `${String(process.pid)}\n`);
      closeSync(0);
      stayAlive();
      break;
    }
    const afterWriteFailure = fault === "after-write-EIO"
      && (operationFault || terminalStateFault);
    if ((operationFault || terminalStateFault) && !afterWriteFailure) {
      if (fault === "stall") {
        stayAlive();
      } else {
        process.stdin.resume();
        await new Promise<void>((resolve) => process.stdin.once("end", resolve));
        process.stderr.write(`${fault ?? "EIO"}: injected writer failure\n`);
        process.exitCode = 1;
      }
      break;
    }
    const markerOperation = process.env.PROBE_WRITER_MARKER_OPERATION
      ?? "publish-log";
    const markerPublicationPhase = process.env.PROBE_WRITER_MARKER_PUBLICATION_PHASE;
    if (operation === markerOperation
      && (markerPublicationPhase === undefined
        || publicationPhase === markerPublicationPhase)) {
      const marker = process.env.PROBE_WRITER_LOG_MARKER;
      if (marker !== undefined) writeFileSync(marker, "publishing\n");
      const delayMs = Number(process.env.PROBE_WRITER_LOG_DELAY_MS ?? "0");
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
    process.argv.splice(2, 1);
    await import("./acceptance-evidence-writer.js");
    if (afterWriteFailure) {
      process.stderr.write("EIO: injected failure after durable write\n");
      process.exitCode = 1;
    }
    break;
  }
  case "empty-process-probe":
    process.exitCode = 0;
    break;
  case "zombie-only-process-probe": {
    const marker = process.env.PROBE_PROCESS_COUNT_PATH;
    if (marker !== undefined) appendFileSync(marker, "scan\n");
    process.exitCode = 3;
    break;
  }
  case "owner": {
    const reportRoot = process.argv[3];
    if (reportRoot === undefined) throw new Error("Owner probe requires a report root");
    await runOwner(reportRoot, "signal-tree", "parent");
    break;
  }
  case "output-error-owner": {
    const reportRoot = process.argv[3];
    if (reportRoot === undefined) {
      throw new Error("Output-error owner probe requires a report root");
    }
    await runOwner(reportRoot, "output-tree", "noisy-parent");
    break;
  }
  case "blocked-console-owner": {
    const reportRoot = process.argv[3];
    if (reportRoot === undefined) {
      throw new Error("Blocked-console owner probe requires a report root");
    }
    const owner = new AcceptanceProcessOwner({
      cwd: process.cwd(),
      reportRoot,
      timeoutMs: 5_000,
      terminationGraceMs: 100,
      limits: {
        consoleWriteMs: 100,
        drainMs: 100,
        statePublicationMs: 15_000
      }
    });
    await owner.run({
      id: "blocked-console",
      command: process.execPath,
      args: [script, "bytes", String(4 * 1024 * 1024)]
    });
    break;
  }
  case "publication-signal-owner": {
    const reportRoot = process.argv[3];
    const marker = process.argv[4];
    if (reportRoot === undefined || marker === undefined) {
      throw new Error("Publication signal probe requires report and marker paths");
    }
    await runOwner(reportRoot, "publication-signal", "healthy", {
      command: process.execPath,
      args: [script, "writer-proxy"],
      env: {
        PROBE_WRITER_LOG_MARKER: marker,
        PROBE_WRITER_LOG_DELAY_MS: "1000",
        PROBE_WRITER_MARKER_OPERATION: "publish-state",
        PROBE_WRITER_MARKER_PUBLICATION_PHASE: "terminal"
      }
    });
    break;
  }
  case "cleanup-failure-owner": {
    const reportRoot = process.argv[3];
    const childMode = process.argv[4] ?? "cleanup-survivor";
    if (reportRoot === undefined) {
      throw new Error("Cleanup-failure owner probe requires a report root");
    }
    let childIdentityRecorded = false;
    const owner = new AcceptanceProcessOwner({
      cwd: process.cwd(),
      reportRoot,
      timeoutMs: 5_000,
      terminationGraceMs: 50,
      stdout: new FailAfterSentinelSink(`probe:${childMode}:`),
      limits: {
        drainMs: 20,
        consoleWriteMs: 100,
        logPublicationMs: 2_000,
        statePublicationMs: 2_000
      },
      onChildSpawn: (child) => {
        if (child.pid === undefined) throw new Error("cleanup child PID is unavailable");
        const fallbackPidPath = process.env.PROBE_FALLBACK_PID_PATH;
        if (fallbackPidPath !== undefined) {
          writeFileSync(fallbackPidPath, `${String(child.pid)}\n`);
        }
        const pidPath = process.env.PROBE_PID_PATH;
        if (pidPath !== undefined) writeFileSync(pidPath, `${String(child.pid)}\n`);
        childIdentityRecorded = true;
      },
      terminateProcessTree: async (child, graceMs, processProbeMs, onProbeDegraded, processProbe) => {
        if (!childIdentityRecorded) {
          await terminateAcceptanceProcessTree(
            child,
            graceMs,
            processProbeMs,
            onProbeDegraded,
            processProbe
          );
          return;
        }
        throw new Error("injected cleanup failure");
      },
      ...(childMode === "delayed-exit"
        ? {
            evidenceWriter: {
              command: process.execPath,
              args: [script, "writer-proxy"],
              env: {
                PROBE_WRITER_LOG_DELAY_MS: "500",
                PROBE_WRITER_MARKER_OPERATION: "publish-log"
              }
            }
          }
        : {})
    });
    try {
      await owner.run({
        id: "cleanup-failure",
        command: process.execPath,
        args: [script, childMode, childMode === "delayed-exit" ? "800" : "150"]
      });
    } catch {
      process.exitCode = 1;
    }
    break;
  }
  case "signal-final-write-owner": {
    const reportRoot = process.argv[3];
    const marker = process.argv[4];
    if (reportRoot === undefined || marker === undefined) {
      throw new Error("Signal final-write probe requires report and marker paths");
    }
    const owner = new AcceptanceProcessOwner({
      cwd: process.cwd(),
      reportRoot,
      timeoutMs: 5_000,
      terminationGraceMs: 100,
      stderr: new SignalledStalledSink("probe:final-stalled-write", marker),
      limits: {
        consoleWriteMs: 300,
        drainMs: 500,
        statePublicationMs: 2_000,
        logPublicationMs: 2_000
      }
    });
    try {
      await owner.run({
        id: "signal-final-write",
        command: process.execPath,
        args: [script, "final-stderr"]
      });
    } catch (error: unknown) {
      if (error instanceof AcceptanceInterruptedError) {
        process.exitCode = error.exitCode;
      } else {
        throw error;
      }
    }
    break;
  }
  default:
    throw new Error(`Unknown acceptance owner probe mode: ${String(mode)}`);
}
