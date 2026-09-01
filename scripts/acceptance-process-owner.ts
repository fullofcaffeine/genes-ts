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

/** Terminates only the private process tree started for one acceptance gate. */
export async function terminateAcceptanceProcessTree(
  child: ChildProcess,
  graceMs: number
): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore"
    });
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
  return new Promise((resolve, reject) => {
    log.once("error", reject);
    log.end(resolve);
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
    assert(options.timeoutMs > 0, "Acceptance timeout must be positive");
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
    this.states.push(state);
    this.writeState(gate.id);
    const started = Date.now();
    process.stdout.write(
      `acceptance:start ${gate.id} remaining=${String(remainingMs)}ms\n`
    );

    const log = createWriteStream(logPath, { flags: "w" });
    const child = spawn(gate.command, [...gate.args], {
      cwd: this.options.cwd,
      env: {
        ...(this.options.env ?? process.env),
        ...(gate.env ?? {})
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    for (const [stream, destination] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr]
    ] as const) {
      stream?.on("data", (chunk: Buffer) => {
        destination.write(chunk);
        log.write(chunk);
      });
    }

    const result = await new Promise<{
      readonly status: "passed" | "failed" | "timed-out" | "interrupted";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly error?: Error;
    }>((resolve) => {
      let settled = false;
      let termination:
        | { status: "timed-out" }
        | { status: "interrupted"; signal: "SIGINT" | "SIGTERM" }
        | undefined;
      const finish = (value: {
        readonly status: "passed" | "failed" | "timed-out" | "interrupted";
        readonly code: number | null;
        readonly signal: NodeJS.Signals | null;
        readonly error?: Error;
      }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        process.removeListener("SIGINT", onSigint);
        process.removeListener("SIGTERM", onSigterm);
        resolve(value);
      };
      const terminate = (
        requested:
          | { status: "timed-out" }
          | { status: "interrupted"; signal: "SIGINT" | "SIGTERM" }
      ): void => {
        if (settled) return;
        if (termination !== undefined) {
          if (requested.status === "interrupted") termination = requested;
          return;
        }
        termination = requested;
        const graceMs = this.options.terminationGraceMs ?? 2_000;
        const close = waitForChildClose(child, graceMs * 2);
        void terminateAcceptanceProcessTree(child, graceMs).then(
          async () => {
            const closed = await close;
            const finalTermination = termination ?? requested;
            finish({
              status: finalTermination.status,
              code: null,
              signal: finalTermination.status === "interrupted"
                ? finalTermination.signal
                : null,
              ...(closed ? {} : {
                error: new Error(`${gate.id} root did not close after tree termination`)
              })
            });
          },
          (error: unknown) => finish({
            status: termination?.status ?? requested.status,
            code: null,
            signal: termination?.status === "interrupted"
              ? termination.signal
              : null,
            error: error instanceof Error ? error : new Error(String(error))
          })
        );
      };
      const onSigint = (): void => terminate({
        status: "interrupted",
        signal: "SIGINT"
      });
      const onSigterm = (): void => terminate({
        status: "interrupted",
        signal: "SIGTERM"
      });
      process.once("SIGINT", onSigint);
      process.once("SIGTERM", onSigterm);
      const timeout = setTimeout(
        () => terminate({ status: "timed-out" }),
        remainingMs
      );
      child.once("error", (error) => finish({
        status: "failed",
        code: null,
        signal: null,
        error
      }));
      child.once("close", (code, signal) => {
        if (termination !== undefined) return;
        finish({
          status: code === 0 ? "passed" : "failed",
          code,
          signal
        });
      });
    });
    await closeLog(log);

    const completed: GateState = {
      ...state,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      status: result.status,
      exitCode: result.code,
      signal: result.signal
    };
    this.states[this.states.length - 1] = completed;
    this.writeState(result.status === "passed" ? null : gate.id);
    if (result.status === "passed") {
      process.stdout.write(
        `acceptance:pass ${gate.id} duration=${String(completed.durationMs)}ms\n`
      );
      return;
    }
    process.stderr.write(
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
  }
}
