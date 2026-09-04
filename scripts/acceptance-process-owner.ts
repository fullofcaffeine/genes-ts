import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Writable } from "node:stream";

export interface AcceptanceGate {
  readonly id: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: NodeJS.ProcessEnv;
}

export interface AcceptanceOwnerLimits {
  readonly retainedBytesPerGate: number;
  readonly consoleBytesPerGate: number;
  readonly observedBytesTotal: number;
  readonly processProbeMs: number;
  readonly drainMs: number;
  readonly consoleWriteMs: number;
  readonly logPublicationMs: number;
  readonly statePublicationMs: number;
}

interface EvidenceWriterCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: NodeJS.ProcessEnv;
}

interface ProcessProbeCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: NodeJS.ProcessEnv;
}

type EvidenceOperation = "reset-report" | "publish-state" | "publish-log";

/** @internal Typed observations consumed by the process-group wait state machine. */
export type ProcessGroupObservation =
  | { readonly kind: "live" }
  | { readonly kind: "absent" }
  | { readonly kind: "zombie-only" }
  | { readonly kind: "degraded-live" }
  | { readonly kind: "degraded-absent" };

/** @internal Testable process-group observation boundary. */
export interface ProcessGroupObserver {
  observeGroup(pid: number, budgetMs: number): Promise<ProcessGroupObservation>;
  fallbackGroupPresence(pid: number): "live" | "absent";
}

/** @internal Monotonic time boundary for deterministic wait-loop tests. */
export interface MonotonicWaitRuntime {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

export interface AcceptanceProcessOwnerOptions {
  readonly cwd: string;
  readonly reportRoot: string;
  readonly timeoutMs: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly terminationGraceMs?: number;
  readonly limits?: Partial<AcceptanceOwnerLimits>;
  readonly stdout?: Writable;
  readonly stderr?: Writable;
  /** Test seam for deterministic writer stalls and failures. */
  readonly evidenceWriter?: EvidenceWriterCommand;
  /** Test seam for deterministic process-probe stalls and failures. */
  readonly processProbe?: ProcessProbeCommand;
  /** Test seam for cleanup failure without changing production policy. */
  readonly terminateProcessTree?: typeof terminateAcceptanceProcessTree;
  /** Test seam that records the exact child identity before child output. */
  readonly onChildSpawn?: (child: ChildProcess) => void;
  /** Synchronous test observer immediately before an evidence writer starts. */
  readonly onEvidenceOperationDispatch?: (operation: EvidenceOperation) => void;
}

interface GateState {
  readonly id: string;
  readonly command: ReadonlyArray<string>;
  readonly log: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly phase:
    | "preparing"
    | "running"
    | "stopping"
    | "draining"
    | "publishing-log"
    | "publishing-state"
    | "terminal";
  readonly status: "running" | "passed" | "failed" | "timed-out" | "interrupted";
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly interruption: "SIGINT" | "SIGTERM" | null;
  readonly cleanup: {
    readonly attempted: boolean;
    readonly succeeded: boolean | null;
    readonly error: string | null;
    readonly probeDegraded: boolean;
  };
  readonly output: {
    readonly observedBytes: number;
    readonly retainedBytes: number;
    readonly droppedBytes: number;
    readonly truncated: boolean;
    readonly drainTimedOut: boolean;
    readonly consoleBytes: number;
    readonly consoleDroppedBytes: number;
    readonly consoleTruncated: boolean;
    readonly error: string | null;
  };
  readonly publication: {
    readonly log: "pending" | "published" | "failed";
    readonly state: "published";
    readonly error: string | null;
  };
}

interface AcceptanceState {
  readonly schemaVersion: 2;
  readonly contract: "genes-acceptance-process-owner";
  readonly timeoutMs: number;
  readonly startedAt: string;
  readonly activeGate: string | null;
  readonly limits: AcceptanceOwnerLimits;
  readonly totals: {
    readonly observedBytes: number;
  };
  readonly gates: ReadonlyArray<GateState>;
}

interface MutableFacts {
  rootCode: number | null;
  rootSignal: NodeJS.Signals | null;
  rootObserved: boolean;
  timedOut: boolean;
  interruption: "SIGINT" | "SIGTERM" | null;
  executionError: Error | null;
  outputError: Error | null;
  cleanupError: Error | null;
  cleanupAttempted: boolean;
  cleanupSucceeded: boolean | null;
  probeDegraded: boolean;
  drainTimedOut: boolean;
  logPublished: boolean;
  logError: Error | null;
}

interface OutputPump {
  readonly done: Promise<void>;
  stop(): void;
}

interface ConsoleBudget {
  remaining: number;
  emitted: number;
  dropped: number;
}

const mebibyte = 1024 * 1024;
const markerReserveBytes = 256;
const writerScript = fileURLToPath(
  new URL("./acceptance-evidence-writer.js", import.meta.url)
);
const processProbeScript = fileURLToPath(
  new URL("./acceptance-process-probe.js", import.meta.url)
);

export const defaultAcceptanceOwnerLimits: AcceptanceOwnerLimits = {
  retainedBytesPerGate: 8 * mebibyte,
  consoleBytesPerGate: 16 * mebibyte,
  observedBytesTotal: 256 * mebibyte,
  processProbeMs: 250,
  drainMs: 1_000,
  consoleWriteMs: 5_000,
  logPublicationMs: 5_000,
  statePublicationMs: 2_000
};

/** Largest delay that Node schedules without clamping it to one millisecond. */
export const maxNodeTimerDelayMs = 2_147_483_647;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const systemMonotonicWaitRuntime: MonotonicWaitRuntime = {
  now: () => performance.now(),
  sleep: delay
};

function monotonicDeadline(
  timeoutMs: number,
  runtime: MonotonicWaitRuntime = systemMonotonicWaitRuntime
): number {
  return runtime.now() + timeoutMs;
}

function remainingMs(
  deadline: number,
  runtime: MonotonicWaitRuntime = systemMonotonicWaitRuntime
): number {
  return Math.max(0, Math.ceil(deadline - runtime.now()));
}

function settlesWithin(operation: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);
    void operation.then(() => finish(true), () => finish(true));
  });
}

function positiveInteger(value: number, label: string): number {
  assert(Number.isSafeInteger(value) && value > 0, `${label} must be a positive integer`);
  return value;
}

function takeConsoleBytes(
  budget: ConsoleBudget,
  bytes: Buffer,
  allOrNone = false
): Buffer {
  const accepted = allOrNone && bytes.length > budget.remaining
    ? 0
    : Math.min(bytes.length, budget.remaining);
  budget.remaining -= accepted;
  budget.emitted += accepted;
  budget.dropped += bytes.length - accepted;
  return bytes.subarray(0, accepted);
}

function dropConsoleBytes(budget: ConsoleBudget, bytes: Buffer): void {
  budget.dropped += bytes.length;
}

function writeWithDeadline(
  destination: Writable,
  bytes: Buffer,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      destination.removeListener("error", onError);
      if (error === undefined || error === null) resolve();
      else reject(error);
    };
    const onError = (error: Error): void => finish(error);
    const timeout = setTimeout(() => {
      const error = new Error(`Console write exceeded ${String(timeoutMs)}ms`);
      // Rejecting the Promise does not release an OS pipe's pending libuv
      // write. Destroy the exact destination so the bounded owner can exit.
      destination.destroy(error);
      finish(error);
    }, timeoutMs);
    destination.once("error", onError);
    if (destination.destroyed || destination.writableEnded) {
      finish(new Error("Acceptance console destination is closed"));
      return;
    }
    try {
      destination.write(bytes, (error?: Error | null) => finish(error));
    } catch (error: unknown) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

class TailBuffer {
  private readonly bytes: Buffer;
  private length = 0;
  private cursor = 0;

  public constructor(capacity: number) {
    this.bytes = Buffer.alloc(capacity);
  }

  public append(chunk: Buffer): void {
    if (this.bytes.length === 0 || chunk.length === 0) return;
    if (chunk.length >= this.bytes.length) {
      chunk.copy(this.bytes, 0, chunk.length - this.bytes.length);
      this.length = this.bytes.length;
      this.cursor = 0;
      return;
    }
    const first = Math.min(chunk.length, this.bytes.length - this.cursor);
    chunk.copy(this.bytes, this.cursor, 0, first);
    if (first < chunk.length) chunk.copy(this.bytes, 0, first);
    this.cursor = (this.cursor + chunk.length) % this.bytes.length;
    this.length = Math.min(this.bytes.length, this.length + chunk.length);
  }

  public materialize(): Buffer {
    if (this.length < this.bytes.length) return this.bytes.subarray(0, this.length);
    return Buffer.concat([
      this.bytes.subarray(this.cursor),
      this.bytes.subarray(0, this.cursor)
    ], this.length);
  }

  public get size(): number {
    return this.length;
  }
}

class BoundedOutput {
  private readonly headChunks: Buffer[] = [];
  private readonly tail: TailBuffer;
  private headLength = 0;
  public observedBytes = 0;

  public constructor(
    private readonly retainedLimit: number,
    private readonly observedLimit: number
  ) {
    const dataLimit = Math.max(0, retainedLimit - markerReserveBytes);
    const headLimit = Math.min(6 * mebibyte, dataLimit);
    this.headLimit = headLimit;
    this.tail = new TailBuffer(dataLimit - headLimit);
  }

  private readonly headLimit: number;

  public append(chunk: Buffer): boolean {
    this.observedBytes += chunk.length;
    const missingHead = this.headLimit - this.headLength;
    const headBytes = Math.min(missingHead, chunk.length);
    if (headBytes > 0) {
      this.headChunks.push(chunk.subarray(0, headBytes));
      this.headLength += headBytes;
    }
    this.tail.append(chunk.subarray(headBytes));
    return this.observedBytes > this.observedLimit;
  }

  public materialize(): Buffer {
    const head = Buffer.concat(this.headChunks, this.headLength);
    const tail = this.tail.materialize();
    const dropped = Math.max(0, this.observedBytes - head.length - tail.length);
    if (dropped === 0) return Buffer.concat([head, tail]);
    const marker = Buffer.from(
      `\n[genes acceptance output truncated: ${String(dropped)} bytes omitted]\n`
    );
    if (this.retainedLimit < marker.length) {
      return marker.subarray(0, this.retainedLimit);
    }
    assert(
      head.length + marker.length + tail.length <= this.retainedLimit,
      "Retained output exceeded its fixed limit"
    );
    return Buffer.concat([head, marker, tail]);
  }

  public snapshot(): {
    readonly retainedBytes: number;
    readonly droppedBytes: number;
    readonly truncated: boolean;
  } {
    const retainedBytes = this.materialize().length;
    const droppedBytes = Math.max(
      0,
      this.observedBytes - this.headLength - this.tail.size
    );
    return { retainedBytes, droppedBytes, truncated: droppedBytes > 0 };
  }
}

function kernelProcessPresence(pid: number, group: boolean): "live" | "absent" {
  try {
    process.kill(group ? -pid : pid, 0);
    return "live";
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return "absent";
    }
    return "live";
  }
}

async function runProcessProbe(
  probe: ProcessProbeCommand,
  operation: "--group" | "--pid",
  pid: number,
  timeoutMs: number
): Promise<ProcessGroupObservation> {
  if (process.platform === "win32") return { kind: "absent" };
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(probe.command, [...probe.args, operation, String(pid)], {
      env: {
        ...process.env,
        ...(probe.env ?? {})
      },
      stdio: "ignore"
    });
    const finish = (result: ProcessGroupObservation): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      resolve(result);
    };
    const degradedFallback = (): ProcessGroupObservation => ({
      kind: kernelProcessPresence(pid, operation === "--group") === "live"
        ? "degraded-live"
        : "degraded-absent"
    });
    const onError = (): void => finish(degradedFallback());
    const onExit = (code: number | null): void => {
      if (code === 0) {
        const kernel = kernelProcessPresence(pid, operation === "--group");
        finish({ kind: kernel });
      }
      else if (code === 1) finish({ kind: "live" });
      else if (code === 3) finish({ kind: "zombie-only" });
      else finish(degradedFallback());
    };
    const timeout = setTimeout(() => {
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.once("error", () => {});
      child.kill("SIGKILL");
      child.unref();
      finish(degradedFallback());
    }, Math.max(1, timeoutMs));
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function spawnedProcessGroupObserver(probe: ProcessProbeCommand): ProcessGroupObserver {
  return {
    observeGroup: (pid, budgetMs) => runProcessProbe(probe, "--group", pid, budgetMs),
    fallbackGroupPresence: (pid) => kernelProcessPresence(pid, true)
  };
}

async function waitForProcessGroupExit(
  pid: number,
  timeoutMs: number,
  probeMs: number,
  onDegraded: () => void,
  observer: ProcessGroupObserver,
  runtime: MonotonicWaitRuntime = systemMonotonicWaitRuntime
): Promise<boolean> {
  const deadline = monotonicDeadline(timeoutMs, runtime);
  let probeDegraded = false;
  let consecutiveZombieOnlyScans = 0;
  do {
    const availableMs = remainingMs(deadline, runtime);
    const observation: ProcessGroupObservation = probeDegraded
      ? {
          kind: observer.fallbackGroupPresence(pid) === "live"
            ? "degraded-live"
            : "degraded-absent"
        }
      : await observer.observeGroup(
          pid,
          Math.min(probeMs, Math.max(1, availableMs))
        );
    switch (observation.kind) {
      case "degraded-live":
      case "degraded-absent":
        probeDegraded = true;
        onDegraded();
        consecutiveZombieOnlyScans = 0;
        if (observation.kind === "degraded-absent") return true;
        break;
      case "zombie-only":
        consecutiveZombieOnlyScans += 1;
        if (consecutiveZombieOnlyScans >= 2) return true;
        break;
      case "absent":
        return true;
      case "live":
        consecutiveZombieOnlyScans = 0;
        break;
    }
    const sleepRemainingMs = remainingMs(deadline, runtime);
    if (sleepRemainingMs > 0) {
      await runtime.sleep(Math.min(25, sleepRemainingMs));
    }
  } while (remainingMs(deadline, runtime) > 0);
  return observer.fallbackGroupPresence(pid) === "absent";
}

async function runBoundedCommand(
  command: string,
  args: ReadonlyArray<string>,
  timeoutMs: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const child = spawn(command, [...args], { stdio: "ignore" });
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onError = (error: Error): void => finish(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (code === 0) finish();
      else finish(new Error(`${command} failed with ${signal ?? `exit ${String(code)}`}`));
    };
    const timeout = setTimeout(() => {
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.once("error", () => {});
      child.kill("SIGKILL");
      child.unref();
      finish(new Error(`${command} exceeded ${String(timeoutMs)}ms`));
    }, timeoutMs);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

/**
 * Terminates one private POSIX process group under two finite grace periods.
 *
 * Windows keeps the existing best-effort taskkill path. Bead genes-tk76 owns
 * race-free Windows descendant containment through Job Objects.
 */
export async function terminateAcceptanceProcessTree(
  child: ChildProcess,
  graceMs: number,
  processProbeMs = defaultAcceptanceOwnerLimits.processProbeMs,
  onProbeDegraded: () => void = () => {},
  probe: ProcessProbeCommand = {
    command: process.execPath,
    args: [processProbeScript]
  }
): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    await runBoundedCommand("taskkill", ["/pid", String(pid), "/t", "/f"], graceMs);
    return;
  }

  const observer = spawnedProcessGroupObserver(probe);

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      return;
    }
  }
  if (await waitForProcessGroupExit(
    pid,
    graceMs,
    processProbeMs,
    onProbeDegraded,
    observer
  )) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The exact tree exited between the liveness check and signal.
    }
  }
  assert(
    await waitForProcessGroupExit(pid, graceMs, processProbeMs, onProbeDegraded, observer),
    `Acceptance process group ${String(pid)} survived SIGKILL`
  );
}

/** Internal semantic and adapter seams; production callers cannot replace the observer. */
export const acceptanceProcessOwnerTestOnly = {
  waitForProcessGroupExit,
  runProcessProbe
} as const;

export class AcceptanceInterruptedError extends Error {
  public readonly exitCode: 130 | 143;

  public constructor(public readonly signal: "SIGINT" | "SIGTERM") {
    super(`Acceptance interrupted by ${signal}`);
    this.name = "AcceptanceInterruptedError";
    this.exitCode = signal === "SIGINT" ? 130 : 143;
  }
}

export class AcceptanceEvidenceError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AcceptanceEvidenceError";
  }
}

/** Owns sequential acceptance gates under one aggregate execution deadline. */
export class AcceptanceProcessOwner {
  private readonly startedAt = new Date().toISOString();
  private readonly deadline: number;
  private readonly limits: AcceptanceOwnerLimits;
  private readonly states: GateState[] = [];
  private readonly writer: EvidenceWriterCommand;
  private totalObservedBytes = 0;
  private reportPrepared = false;
  private gateActive = false;

  public constructor(private readonly options: AcceptanceProcessOwnerOptions) {
    assert(
      Number.isSafeInteger(options.timeoutMs)
        && options.timeoutMs > 0
        && options.timeoutMs <= maxNodeTimerDelayMs,
      `Acceptance timeout must be an integer from 1 to ${String(maxNodeTimerDelayMs)}`
    );
    this.limits = {
      ...defaultAcceptanceOwnerLimits,
      ...(options.limits ?? {})
    };
    for (const [label, value] of Object.entries(this.limits)) positiveInteger(value, label);
    for (const label of [
      "processProbeMs",
      "drainMs",
      "consoleWriteMs",
      "logPublicationMs",
      "statePublicationMs"
    ] as const) {
      assert(
        this.limits[label] <= maxNodeTimerDelayMs,
        `${label} must not exceed ${String(maxNodeTimerDelayMs)}`
      );
    }
    if (options.terminationGraceMs !== undefined) {
      assert(
        Number.isSafeInteger(options.terminationGraceMs)
          && options.terminationGraceMs > 0
          && options.terminationGraceMs <= maxNodeTimerDelayMs,
        `terminationGraceMs must be an integer from 1 to ${String(maxNodeTimerDelayMs)}`
      );
    }
    assert(
      this.limits.retainedBytesPerGate <= 8 * mebibyte,
      "Per-gate retained output must not exceed the writer contract"
    );
    this.writer = options.evidenceWriter ?? {
      command: process.execPath,
      args: [writerScript]
    };
    this.deadline = monotonicDeadline(options.timeoutMs);
  }

  private async evidenceOperation(
    operation: EvidenceOperation,
    args: ReadonlyArray<string>,
    input: Buffer,
    timeoutMs: number
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let stderr = "";
      this.options.onEvidenceOperationDispatch?.(operation);
      const child = spawn(
        this.writer.command,
        [...this.writer.args, operation, this.options.reportRoot, ...args],
        {
          cwd: this.options.cwd,
          env: {
            ...(this.options.env ?? process.env),
            ...(this.writer.env ?? {})
          },
          stdio: ["pipe", "ignore", "pipe"]
        }
      );
      let inputError: Error | null = null;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
        child.stdin?.removeListener("error", onInputError);
        child.stderr?.removeListener("data", onStderr);
        if (error === undefined) resolve();
        else reject(error);
      };
      const onError = (error: Error): void => finish(error);
      const onStderr = (value: Buffer | string): void => {
        if (stderr.length >= 64 * 1024) return;
        stderr += Buffer.isBuffer(value) ? value.toString("utf8") : value;
      };
      const onInputError = (error: Error): void => {
        inputError ??= error;
        child.stdin?.destroy();
        child.kill("SIGKILL");
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (inputError !== null) finish(inputError);
        else if (code === 0) finish();
        else finish(new Error(
          `${operation} writer failed with ${signal ?? `exit ${String(code)}`}`
          + (stderr.length === 0 ? "" : `: ${stderr.trim()}`)
        ));
      };
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        child.stdin?.destroy();
        child.stderr?.destroy();
        child.unref();
        finish(new Error(`${operation} exceeded ${String(timeoutMs)}ms`));
      }, timeoutMs);
      child.once("error", onError);
      child.stderr?.on("data", onStderr);
      child.once("exit", onExit);
      child.stdin?.on("error", onInputError);
      child.stdin?.end(input);
    });
  }

  private stateBytes(activeGate: string | null, current: GateState): Buffer {
    const gates = [...this.states, current];
    const state: AcceptanceState = {
      schemaVersion: 2,
      contract: "genes-acceptance-process-owner",
      timeoutMs: this.options.timeoutMs,
      startedAt: this.startedAt,
      activeGate,
      limits: this.limits,
      totals: {
        observedBytes: this.totalObservedBytes + current.output.observedBytes
      },
      gates
    };
    return Buffer.from(`${JSON.stringify(state, null, 2)}\n`);
  }

  private startOutputPump(
    stream: NodeJS.ReadableStream | null,
    destination: Writable,
    output: BoundedOutput,
    consoleBudget: ConsoleBudget,
    onFatal: (error: Error) => void,
    onObservedLimit: () => void
  ): OutputPump {
    let readableState: "open" | "ended" | "stopped" = "open";
    let inFlightWrite: Promise<void> | null = null;
    let settled = false;
    let settleDone: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      settleDone = resolve;
    });
    if (stream === null) {
      settleDone();
      return { done, stop: () => {} };
    }
    const removeListeners = (): void => {
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("close", onClose);
      stream.removeListener("error", onError);
    };
    const settleIfQuiescent = (): void => {
      if (settled || readableState === "open" || inFlightWrite !== null) return;
      settled = true;
      removeListeners();
      settleDone();
    };
    const stop = (): void => {
      if (readableState === "stopped") return;
      readableState = "stopped";
      stream.removeListener("data", onData);
      if ("destroy" in stream && typeof stream.destroy === "function") stream.destroy();
      settleIfQuiescent();
    };
    const onData = (value: Buffer | string): void => {
      if (readableState !== "open" || inFlightWrite !== null) return;
      stream.pause();
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (output.append(chunk)) {
        dropConsoleBytes(consoleBudget, chunk);
        onObservedLimit();
        return;
      }
      const bytes = takeConsoleBytes(consoleBudget, chunk);
      inFlightWrite = bytes.length === 0
        ? Promise.resolve()
        : writeWithDeadline(destination, bytes, this.limits.consoleWriteMs);
      void inFlightWrite.then(
        () => {
          inFlightWrite = null;
          if (readableState === "open") stream.resume();
          settleIfQuiescent();
        },
        (error: unknown) => {
          inFlightWrite = null;
          onFatal(error instanceof Error ? error : new Error(String(error)));
          stop();
          settleIfQuiescent();
        }
      );
    };
    const onEnd = (): void => {
      if (readableState === "open") readableState = "ended";
      settleIfQuiescent();
    };
    const onClose = (): void => {
      if (readableState === "open") readableState = "ended";
      settleIfQuiescent();
    };
    const onError = (error: Error): void => {
      onFatal(error);
      stop();
      settleIfQuiescent();
    };
    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("close", onClose);
    stream.once("error", onError);
    return {
      done,
      stop
    };
  }

  public async run(gate: AcceptanceGate): Promise<void> {
    assert(!this.gateActive, "Acceptance gates must run sequentially");
    assert(
      gate.id.length <= 96 && /^[a-z0-9][a-z0-9-]*$/u.test(gate.id),
      `Invalid gate id: ${gate.id}`
    );
    const startedAt = new Date().toISOString();
    const startedMonotonic = performance.now();
    const observedRemaining = Math.max(
      0,
      this.limits.observedBytesTotal - this.totalObservedBytes
    );
    const output = new BoundedOutput(
      this.limits.retainedBytesPerGate,
      observedRemaining
    );
    const consoleBudget = {
      remaining: this.limits.consoleBytesPerGate,
      emitted: 0,
      dropped: 0
    };
    const facts: MutableFacts = {
      rootCode: null,
      rootSignal: null,
      rootObserved: false,
      timedOut: false,
      interruption: null,
      executionError: null,
      outputError: null,
      cleanupError: null,
      cleanupAttempted: false,
      cleanupSucceeded: null,
      probeDegraded: false,
      drainTimedOut: false,
      logPublished: false,
      logError: null
    };
    const logPath = path.join(this.options.reportRoot, `${gate.id}.log`);
    const snapshot = (
      phase: GateState["phase"],
      status: GateState["status"],
      publicationState: "pending" | "published" | "failed"
    ): GateState => {
      const retained = output.snapshot();
      const error = facts.outputError ?? facts.executionError;
      return {
        id: gate.id,
        command: [gate.command, ...gate.args],
        log: path.relative(this.options.cwd, logPath),
        startedAt,
        completedAt: phase === "terminal" ? new Date().toISOString() : null,
        durationMs: phase === "terminal"
          ? Math.max(0, Math.round(performance.now() - startedMonotonic))
          : null,
        phase,
        status,
        exitCode: facts.rootCode,
        signal: facts.rootSignal,
        interruption: facts.interruption,
        cleanup: {
          attempted: facts.cleanupAttempted,
          succeeded: facts.cleanupSucceeded,
          error: facts.cleanupError === null ? null : errorMessage(facts.cleanupError),
          probeDegraded: facts.probeDegraded
        },
        output: {
          observedBytes: output.observedBytes,
          retainedBytes: retained.retainedBytes,
          droppedBytes: retained.droppedBytes,
          truncated: retained.truncated,
          drainTimedOut: facts.drainTimedOut,
          consoleBytes: consoleBudget.emitted,
          consoleDroppedBytes: consoleBudget.dropped,
          consoleTruncated: consoleBudget.dropped > 0,
          error: error === null ? null : errorMessage(error)
        },
        publication: {
          log: publicationState,
          state: "published",
          error: facts.logError === null ? null : errorMessage(facts.logError)
        }
      };
    };

    let pendingSignal: "SIGINT" | "SIGTERM" | null = null;
    let requestStop: () => void = () => {};
    const stdoutDestination = this.options.stdout ?? process.stdout;
    const stderrDestination = this.options.stderr ?? process.stderr;
    const consoleDestinations = [...new Set([stdoutDestination, stderrDestination])];
    let consoleAuthorityOpen = true;
    const onConsoleError = (error: Error): void => {
      if (!consoleAuthorityOpen) return;
      facts.outputError ??= error;
      requestStop();
    };
    for (const destination of consoleDestinations) {
      destination.on("error", onConsoleError);
    }
    const onSignal = (signal: "SIGINT" | "SIGTERM"): void => {
      pendingSignal ??= signal;
      facts.interruption = pendingSignal;
      requestStop();
    };
    const onSigint = (): void => onSignal("SIGINT");
    const onSigterm = (): void => onSignal("SIGTERM");
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    const publishState = async (
      phase: "active" | "terminal",
      state: GateState
    ): Promise<void> => {
      await this.evidenceOperation(
        "publish-state",
        [phase],
        this.stateBytes(state.status === "passed" ? null : gate.id, state),
        this.limits.statePublicationMs
      );
    };

    const statusFromFacts = (): GateState["status"] => {
      if (facts.interruption !== null) return "interrupted";
      if (facts.timedOut) return "timed-out";
      if (
        facts.executionError !== null
        || facts.outputError !== null
        || facts.cleanupError !== null
        || facts.logError !== null
        || !facts.rootObserved
        || facts.rootCode !== 0
      ) return "failed";
      return "passed";
    };

    const finishBeforeStart = async (): Promise<never> => {
      if (remainingMs(this.deadline) <= 0) facts.timedOut = true;
      try {
        await this.evidenceOperation(
          "publish-log",
          [gate.id],
          output.materialize(),
          this.limits.logPublicationMs
        );
        facts.logPublished = true;
      } catch (error: unknown) {
        facts.logError = error instanceof Error ? error : new Error(String(error));
      }
      let status = statusFromFacts();
      let terminal = snapshot(
        "terminal",
        status,
        facts.logPublished ? "published" : "failed"
      );
      const publishedSignal = facts.interruption;
      try {
        await publishState("terminal", terminal);
      } catch (error: unknown) {
        throw new AcceptanceEvidenceError(
          `Pre-start terminal state publication failed for ${gate.id}`,
          { cause: error }
        );
      }
      status = statusFromFacts();
      if (facts.interruption !== publishedSignal) {
        terminal = snapshot(
          "terminal",
          status,
          facts.logPublished ? "published" : "failed"
        );
        try {
          await publishState("terminal", terminal);
        } catch (error: unknown) {
          throw new AcceptanceEvidenceError(
            `Reconciled pre-start state publication failed for ${gate.id}`,
            { cause: error }
          );
        }
      }
      this.states.push(terminal);
      this.totalObservedBytes += terminal.output.observedBytes;
      if (facts.interruption !== null) {
        throw new AcceptanceInterruptedError(facts.interruption);
      }
      if (facts.timedOut) {
        throw new Error(`Acceptance timed out before ${gate.id} started; log: ${logPath}`);
      }
      const cause = facts.logError ?? facts.outputError ?? facts.executionError;
      if (cause !== null) throw cause;
      throw new Error(`Acceptance failed before ${gate.id} started; log: ${logPath}`);
    };

    this.gateActive = true;
    try {
      try {
        if (!this.reportPrepared) {
          await this.evidenceOperation(
            "reset-report",
            [],
            Buffer.alloc(0),
            this.limits.statePublicationMs
          );
          this.reportPrepared = true;
        }
      } catch (error: unknown) {
        throw new AcceptanceEvidenceError(
          `Initial acceptance evidence publication failed for ${gate.id}`,
          { cause: error }
        );
      }
      if (
        facts.interruption !== null
        || facts.outputError !== null
        || remainingMs(this.deadline) <= 0
      ) {
        await finishBeforeStart();
      }
      try {
        await publishState("active", snapshot("running", "running", "pending"));
      } catch (error: unknown) {
        throw new AcceptanceEvidenceError(
          `Active acceptance state publication failed for ${gate.id}`,
          { cause: error }
        );
      }
      if (facts.interruption !== null || remainingMs(this.deadline) <= 0) {
        await finishBeforeStart();
      }

      const executionRemainingMs = remainingMs(this.deadline);
      const startMarker = Buffer.from(
        `acceptance:start ${gate.id} remaining=${String(executionRemainingMs)}ms\n`
      );
      if (output.append(startMarker)) {
        facts.outputError = new Error("Acceptance output exceeded its observed-byte limit");
      }
      const startBytes = takeConsoleBytes(consoleBudget, startMarker);
      try {
        if (startBytes.length > 0) {
          await writeWithDeadline(
            stdoutDestination,
            startBytes,
            this.limits.consoleWriteMs
          );
        }
      } catch (error: unknown) {
        facts.outputError = error instanceof Error ? error : new Error(String(error));
      }
      if (
        facts.interruption !== null
        || facts.outputError !== null
        || remainingMs(this.deadline) <= 0
      ) {
        await finishBeforeStart();
      }

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
      let childSpawnError: Error | null = null;
      try {
        this.options.onChildSpawn?.(child);
      } catch (error: unknown) {
        childSpawnError = error instanceof Error ? error : new Error(String(error));
      }
      let stopResolved = false;
      let resolveStop: () => void = () => {};
      const stop = new Promise<void>((resolve) => {
        resolveStop = resolve;
      });
      requestStop = () => {
        if (stopResolved) return;
        stopResolved = true;
        resolveStop();
      };
      const fatalOutput = (error: Error): void => {
        facts.outputError ??= error;
        requestStop();
      };
      const observedLimit = (): void => {
        facts.outputError ??= new Error("Acceptance output exceeded its observed-byte limit");
        requestStop();
      };
      const stdoutPump = this.startOutputPump(
        child.stdout,
        stdoutDestination,
        output,
        consoleBudget,
        fatalOutput,
        observedLimit
      );
      const stderrPump = this.startOutputPump(
        child.stderr,
        stderrDestination,
        output,
        consoleBudget,
        fatalOutput,
        observedLimit
      );
      let childAuthorityOpen = true;
      const onChildError = (error: Error): void => {
        if (!childAuthorityOpen) return;
        facts.executionError ??= error;
        requestStop();
      };
      const onRoot = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (!childAuthorityOpen) return;
        facts.rootObserved = true;
        facts.rootCode = code;
        facts.rootSignal = signal;
        clearTimeout(executionTimer);
        requestStop();
      };
      const rootEvent = process.platform === "win32" ? "close" : "exit";
      const freezeChildAuthority = (): void => {
        if (!childAuthorityOpen) return;
        childAuthorityOpen = false;
        child.removeListener("error", onChildError);
        child.removeListener(rootEvent, onRoot);
        child.unref();
      };
      child.once("error", onChildError);
      child.once(rootEvent, onRoot);
      const executionTimer = setTimeout(() => {
        facts.timedOut = true;
        requestStop();
      }, Math.max(1, executionRemainingMs));
      if (executionRemainingMs === 0) facts.timedOut = true;
      if (pendingSignal !== null
        || facts.outputError !== null
        || facts.timedOut
        || childSpawnError !== null) {
        facts.executionError ??= childSpawnError;
        requestStop();
      }

      await stop;
      clearTimeout(executionTimer);
      if (process.platform === "win32" && facts.rootObserved) {
        // A normal Windows root exit preserves its result. This branch cannot
        // claim descendant ownership after the PID disappears; genes-tk76
        // owns the separate Job Object contract.
        facts.cleanupAttempted = false;
        facts.cleanupSucceeded = null;
      } else {
        facts.cleanupAttempted = true;
        try {
          await (this.options.terminateProcessTree ?? terminateAcceptanceProcessTree)(
            child,
            this.options.terminationGraceMs ?? 2_000,
            this.limits.processProbeMs,
            () => { facts.probeDegraded = true; },
            this.options.processProbe
          );
          facts.cleanupSucceeded = true;
        } catch (error: unknown) {
          facts.cleanupSucceeded = false;
          facts.cleanupError = error instanceof Error ? error : new Error(String(error));
          freezeChildAuthority();
          stdoutPump.stop();
          stderrPump.stop();
          child.stdout?.destroy();
          child.stderr?.destroy();
        }
      }

      const pumpsDone = Promise.all([stdoutPump.done, stderrPump.done]);
      const drained = await settlesWithin(pumpsDone, this.limits.drainMs);
      if (!drained) {
        facts.drainTimedOut = true;
        stdoutPump.stop();
        stderrPump.stop();
        await pumpsDone;
      }
      freezeChildAuthority();

      try {
        await this.evidenceOperation(
          "publish-log",
          [gate.id],
          output.materialize(),
          this.limits.logPublicationMs
        );
        facts.logPublished = true;
      } catch (error: unknown) {
        facts.logError = error instanceof Error ? error : new Error(String(error));
      }

      let status = statusFromFacts();
      const marker = Buffer.from(
        `acceptance:${status} ${gate.id} duration=${String(Math.max(0, Math.round(performance.now() - startedMonotonic)))}ms log=${logPath}\n`
      ).subarray(0, 4 * 1024);
      const markerBytes = takeConsoleBytes(consoleBudget, marker, true);
      try {
        if (markerBytes.length > 0) {
          await writeWithDeadline(
            status === "passed"
              ? stdoutDestination
              : stderrDestination,
            markerBytes,
            Math.min(1_000, this.limits.consoleWriteMs)
          );
        }
      } catch (error: unknown) {
        facts.outputError ??= error instanceof Error ? error : new Error(String(error));
      }
      // Every console write and callback has now settled or destroyed its
      // destination. Freeze console-error authority before durable terminal
      // publication so the one allowed republish can only be signal-driven.
      consoleAuthorityOpen = false;
      status = statusFromFacts();
      let terminal = snapshot(
        "terminal",
        status,
        facts.logPublished ? "published" : "failed"
      );
      const publishedSignal = facts.interruption;
      try {
        await publishState("terminal", terminal);
      } catch (error: unknown) {
        throw new AcceptanceEvidenceError(
          `Terminal acceptance state publication failed for ${gate.id}`,
          { cause: error }
        );
      }

      status = statusFromFacts();
      if (facts.interruption !== publishedSignal) {
        terminal = snapshot(
          "terminal",
          status,
          facts.logPublished ? "published" : "failed"
        );
        try {
          await publishState("terminal", terminal);
        } catch (error: unknown) {
          throw new AcceptanceEvidenceError(
            `Reconciled acceptance state publication failed for ${gate.id}`,
            { cause: error }
          );
        }
      }

      // A signal that triggered reconciliation is already coalesced in
      // pendingSignal, so the second publication cannot discover a new state.
      // Close signal authority synchronously after the final durable commit.
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);

      this.states.push(terminal);
      this.totalObservedBytes += terminal.output.observedBytes;

      if (status === "passed") return;
      if (status === "interrupted") {
        throw new AcceptanceInterruptedError(
          facts.interruption === "SIGINT" ? "SIGINT" : "SIGTERM"
        );
      }
      if (status === "timed-out") {
        throw new Error(
          `Acceptance timed out in ${gate.id} after ${String(terminal.durationMs)}ms; log: ${logPath}`
        );
      }
      const cause = facts.logError
        ?? facts.cleanupError
        ?? facts.outputError
        ?? facts.executionError;
      if (cause !== null) throw cause;
      throw new Error(
        `Acceptance gate ${gate.id} failed with ${facts.rootSignal ?? `exit ${String(facts.rootCode)}`}; log: ${logPath}`
      );
    } catch (error: unknown) {
      if (error instanceof AcceptanceEvidenceError) {
        const diagnostic = Buffer.from(
          `acceptance:evidence-failed ${gate.id}: ${errorMessage(error.cause ?? error)}\n`
        );
        const diagnosticBytes = takeConsoleBytes(
          consoleBudget,
          diagnostic.subarray(0, 4 * 1024)
        );
        try {
          if (diagnosticBytes.length > 0) {
            await writeWithDeadline(
              stderrDestination,
              diagnosticBytes,
              Math.min(1_000, this.limits.consoleWriteMs)
            );
          }
        } catch {
          // state.json remains one complete old or new document.
        }
        if (facts.interruption !== null) {
          throw new AcceptanceInterruptedError(facts.interruption);
        }
      }
      throw error;
    } finally {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      for (const destination of consoleDestinations) {
        destination.removeListener("error", onConsoleError);
      }
      this.gateActive = false;
    }
  }
}
