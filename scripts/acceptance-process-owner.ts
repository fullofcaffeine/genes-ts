import { strict as assert } from "node:assert";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, createWriteStream, type WriteStream } from "node:fs";
import path from "node:path";

export interface AcceptanceGate {
  readonly id: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: NodeJS.ProcessEnv;
}

interface GateState {
  readonly id: string;
  readonly command: ReadonlyArray<string>;
  readonly log: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly status: "running" | "passed" | "failed" | "timed-out" | "interrupted";
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface AcceptanceState {
  readonly schemaVersion: 1;
  readonly contract: "genes-acceptance-process-owner";
  readonly timeoutMs: number;
  readonly startedAt: string;
  readonly activeGate: string | null;
  readonly gates: ReadonlyArray<GateState>;
}

export interface AcceptanceProcessOwnerOptions {
  readonly cwd: string;
  readonly reportRoot: string;
  readonly timeoutMs: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly terminationGraceMs?: number;
}

/** Largest delay that Node schedules without clamping it to one millisecond. */
export const maxNodeTimerDelayMs = 2_147_483_647;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function processGroupAlive(pid: number): boolean {
  if (process.platform === "win32") return false;
  const listing = spawnSync("ps", ["-axo", "pgid=,stat="], {
    encoding: "utf8"
  });
  if (listing.status === 0) {
    return listing.stdout.split("\n").some((line) => {
      const match = /^\s*(\d+)\s+(\S+)/u.exec(line);
      return match !== null
        && Number(match[1]) === pid
        && !match[2].startsWith("Z");
    });
  }
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class AcceptanceInterruptedError extends Error {
  public readonly exitCode: 130 | 143;

  public constructor(public readonly signal: "SIGINT" | "SIGTERM") {
    super(`Acceptance interrupted by ${signal}`);
    this.name = "AcceptanceInterruptedError";
    this.exitCode = signal === "SIGINT" ? 130 : 143;
  }
}

async function waitForProcessGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupAlive(pid)) return true;
    await delay(25);
  }
  return !processGroupAlive(pid);
}

/**
 * Terminates the private POSIX process group started for one acceptance gate.
 *
 * Windows uses its existing PID-tree cleanup only while the root is still
 * addressable. Durable Windows ownership after root exit requires the Job
 * Object boundary tracked by genes-tk76.
 */
export async function terminateAcceptanceProcessTree(
  child: ChildProcess,
  graceMs: number
): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore"
    });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `taskkill failed for acceptance process tree ${String(pid)}`
        + ` with ${result.signal ?? `exit ${String(result.status)}`}`
      );
    }
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      return;
    }
  }
  if (await waitForProcessGroupExit(pid, graceMs)) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The exact owned tree exited between the liveness check and signal.
    }
  }
  assert(
    await waitForProcessGroupExit(pid, graceMs),
    `Acceptance process group ${String(pid)} survived SIGKILL`
  );
}

function closeLog(log: WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (log.closed || log.destroyed) {
      resolve();
      return;
    }
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    log.once("close", finish);
    log.end(finish);
  });
}

function waitForChildClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once("close", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

/** Owns sequential acceptance subgates under one evidence-based deadline. */
export class AcceptanceProcessOwner {
  readonly startedAt = new Date().toISOString();
  readonly deadline: number;
  readonly states: GateState[] = [];
  readonly statePath: string;

  public constructor(readonly options: AcceptanceProcessOwnerOptions) {
    assert(
      Number.isSafeInteger(options.timeoutMs)
        && options.timeoutMs > 0
        && options.timeoutMs <= maxNodeTimerDelayMs,
      `Acceptance timeout must be an integer from 1 to ${String(maxNodeTimerDelayMs)}`
    );
    mkdirSync(options.reportRoot, { recursive: true });
    this.deadline = Date.now() + options.timeoutMs;
    this.statePath = path.join(options.reportRoot, "state.json");
    this.writeState(null);
  }

  private writeState(activeGate: string | null): void {
    const state: AcceptanceState = {
      schemaVersion: 1,
      contract: "genes-acceptance-process-owner",
      timeoutMs: this.options.timeoutMs,
      startedAt: this.startedAt,
      activeGate,
      gates: this.states
    };
    writeFileSync(this.statePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  public async run(gate: AcceptanceGate): Promise<void> {
    assert(/^[a-z0-9][a-z0-9-]*$/.test(gate.id), `Invalid gate id: ${gate.id}`);
    const remainingMs = this.deadline - Date.now();
    assert(remainingMs > 0, `Acceptance timed out before ${gate.id} started`);
    const logPath = path.join(this.options.reportRoot, `${gate.id}.log`);
    const state: GateState = {
      id: gate.id,
      command: [gate.command, ...gate.args],
      log: path.relative(this.options.cwd, logPath),
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationMs: null,
      status: "running",
      exitCode: null,
      signal: null
    };
    let pendingSignal: "SIGINT" | "SIGTERM" | undefined;
    let routeSignal = (signal: "SIGINT" | "SIGTERM"): void => {
      pendingSignal ??= signal;
    };
    const onSigint = (): void => routeSignal("SIGINT");
    const onSigterm = (): void => routeSignal("SIGTERM");
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    const removeSignalHandlers = (): void => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    };
    this.states.push(state);
    this.writeState(gate.id);
    const started = Date.now();
    let outputError: Error | undefined;
    let routeOutputError = (error: Error): void => {
      outputError ??= error;
    };
    const outputListeners = [process.stdout, process.stderr].map(
      (destination) => {
        const listener = (error: Error): void => routeOutputError(error);
        destination.on("error", listener);
        return { destination, listener };
      }
    );
    const removeOutputListeners = (): void => {
      for (const { destination, listener } of outputListeners)
        destination.removeListener("error", listener);
    };
    const writeOutput = (
      destination: NodeJS.WriteStream,
      chunk: string | Buffer
    ): void => {
      if (destination.destroyed) {
        routeOutputError(new Error("Acceptance output stream closed"));
        return;
      }
      try {
        destination.write(chunk);
      } catch (error: unknown) {
        routeOutputError(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    };
    writeOutput(
      process.stdout,
      `acceptance:start ${gate.id} remaining=${String(remainingMs)}ms\n`
    );

    const log = createWriteStream(logPath, { flags: "w" });
    let logError: Error | undefined;
    let routeLogError = (error: Error): void => {
      logError ??= error;
    };
    log.on("error", (error) => routeLogError(error));
    const child = spawn(gate.command, [...gate.args], {
      cwd: this.options.cwd,
      env: {
        ...(this.options.env ?? process.env),
        ...(gate.env ?? {}),
        GENES_ACCEPTANCE_PROCESS_OWNER: "1"
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    for (const [stream, destination] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr]
    ] as const) {
      stream?.on("data", (chunk: Buffer) => {
        writeOutput(destination, chunk);
        log.write(chunk);
      });
    }

    const initialResult = await new Promise<{
      readonly status: "passed" | "failed" | "timed-out" | "interrupted";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly error?: Error;
    }>((resolve) => {
      let settled = false;
      let termination:
        | { status: "timed-out" }
        | { status: "interrupted"; signal: "SIGINT" | "SIGTERM" }
        | { status: "failed"; error: Error }
        | undefined;
      let rootExitResult: {
        readonly status: "passed" | "failed";
        readonly code: number | null;
        readonly signal: NodeJS.Signals | null;
      } | undefined;
      let cleanupStarted = false;
      const finish = (value: {
        readonly status: "passed" | "failed" | "timed-out" | "interrupted";
        readonly code: number | null;
        readonly signal: NodeJS.Signals | null;
        readonly error?: Error;
      }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const startCleanup = (): void => {
        if (cleanupStarted) return;
        cleanupStarted = true;
        const graceMs = this.options.terminationGraceMs ?? 2_000;
        const close = waitForChildClose(child, graceMs * 3 + 250);
        void terminateAcceptanceProcessTree(child, graceMs).then(
          async () => {
            const closed = await close;
            const finalTermination = termination;
            if (finalTermination !== undefined) {
              finish({
                status: finalTermination.status,
                code: null,
                signal: finalTermination.status === "interrupted"
                  ? finalTermination.signal
                  : null,
                ...(closed
                  ? finalTermination.status === "failed"
                    ? { error: finalTermination.error }
                    : {}
                  : {
                    error: new Error(
                      `${gate.id} root did not close after tree termination`
                    )
                  })
              });
              return;
            }
            const completed = rootExitResult;
            finish(closed && completed !== undefined ? completed : {
              status: "failed",
              code: completed?.code ?? null,
              signal: completed?.signal ?? null,
              error: new Error(
                `${gate.id} root streams did not close after tree termination`
              )
            });
          },
          (error: unknown) => {
            const finalTermination = termination;
            finish({
              status: finalTermination?.status ?? "failed",
              code: rootExitResult?.code ?? null,
              signal: finalTermination?.status === "interrupted"
                ? finalTermination.signal
                : rootExitResult?.signal ?? null,
              error: error instanceof Error ? error : new Error(String(error))
            });
          }
        );
      };
      const terminate = (
        requested:
          | { status: "timed-out" }
          | { status: "interrupted"; signal: "SIGINT" | "SIGTERM" }
          | { status: "failed"; error: Error }
      ): void => {
        if (settled) return;
        const priority = (value: typeof requested): number => {
          if (value.status === "failed") return 3;
          if (value.status === "interrupted") return 2;
          return 1;
        };
        if (termination === undefined || priority(requested) > priority(termination)) {
          termination = requested;
        }
        startCleanup();
      };
      routeSignal = (signal: "SIGINT" | "SIGTERM"): void => {
        terminate({ status: "interrupted", signal });
      };
      const timeout = setTimeout(
        () => terminate({ status: "timed-out" }),
        remainingMs
      );
      routeLogError = (error: Error): void => {
        logError ??= error;
        terminate({ status: "failed", error });
      };
      routeOutputError = (error: Error): void => {
        outputError ??= error;
        terminate({ status: "failed", error });
      };
      if (logError !== undefined) routeLogError(logError);
      if (outputError !== undefined) routeOutputError(outputError);
      if (pendingSignal !== undefined) routeSignal(pendingSignal);
      child.once("error", (error) => terminate({ status: "failed", error }));
      const onRootExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (termination !== undefined) return;
        // The command met its execution deadline. Cleanup has its own bounded
        // grace period and must not be reclassified as an execution timeout.
        clearTimeout(timeout);
        rootExitResult = {
          status: code === 0 ? "passed" as const : "failed" as const,
          code,
          signal
        };
        const marker = `acceptance:root-exit ${gate.id}\n`;
        writeOutput(process.stdout, marker);
        log.write(marker);
        startCleanup();
      };
      if (process.platform === "win32") {
        // Windows timeout and signal paths retain their existing best-effort
        // taskkill behavior while the root PID is addressable. A normal close
        // preserves the real result, but this branch does not claim durable
        // descendant ownership after root exit. genes-tk76 owns that Job
        // Object contract and its hosted Windows evidence.
        child.once("close", (code, signal) => {
          if (termination !== undefined) return;
          finish({
            status: code === 0 ? "passed" : "failed",
            code,
            signal
          });
        });
      } else {
        // POSIX can clean the complete private group as soon as its leader
        // exits, even while descendants still hold inherited pipes open.
        child.once("exit", onRootExit);
      }
    });
    await closeLog(log);
    const ioError = logError ?? outputError;
    const result = ioError === undefined ? initialResult : {
      status: "failed" as const,
      code: null,
      signal: null,
      error: ioError
    };

    const completed: GateState = {
      ...state,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      status: result.status,
      exitCode: result.code,
      signal: result.signal
    };
    try {
      this.states[this.states.length - 1] = completed;
      this.writeState(result.status === "passed" ? null : gate.id);
      if (result.status === "passed") {
        writeOutput(
          process.stdout,
          `acceptance:pass ${gate.id} duration=${String(completed.durationMs)}ms\n`
        );
        return;
      }
      writeOutput(
        process.stderr,
        `acceptance:${result.status} ${gate.id} duration=${String(completed.durationMs)}ms log=${logPath}\n`
      );
      if (result.error !== undefined) throw result.error;
      if (result.status === "timed-out") {
        throw new Error(
          `Acceptance timed out in ${gate.id} after ${String(completed.durationMs)}ms; log: ${logPath}`
        );
      }
      if (result.status === "interrupted") {
        throw new AcceptanceInterruptedError(
          result.signal === "SIGINT" ? "SIGINT" : "SIGTERM"
        );
      }
      throw new Error(
        `Acceptance gate ${gate.id} failed with ${result.signal ?? `exit ${String(result.code)}`}; log: ${logPath}`
      );
    } finally {
      // Repeated signals and output errors remain routed until logs and state
      // are durable and the final owner marker has been attempted.
      removeSignalHandlers();
      removeOutputListeners();
    }
  }
}
