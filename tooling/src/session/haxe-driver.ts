import type { ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import {
  OwnedHaxeWaitServer,
  type HaxeWaitEndpoint,
  type HaxeWaitProcessExit,
  type HaxeWaitServerEvent,
  type OwnedHaxeWaitProcess,
} from "../haxe-server/index.js";
import type { HaxeInvocation } from "./types.js";
import type { SessionLayout } from "./layout.js";
import {
  GENES_DEV_INCREMENTAL_DEFINE,
  GENES_OUTPUT_DESCRIPTOR_DEFINE,
  HAXE_4_3_7_DEVELOPMENT_JS_POLICY,
  type BoundHaxeInvocation,
} from "./effective-invocation.js";
import { COMPILER_DATA_DEFINE } from "./compiler-data.js";
import { launchHaxe } from "./haxe-launch.js";

const LOG_LIMIT = 128_000;

export interface CompilerResult {
  readonly mode: "connected" | "direct";
}

/** Private inputs that vary per request without changing wait-server ownership. */
export interface PreparedCompilerRequest {
  readonly classPaths: readonly string[];
  readonly digest: string;
}

export interface SessionCompiler {
  /**
   * Runs one Haxe request for a bound invocation.
   *
   * `invalidatedFiles` lists the absolute paths of source files that changed
   * since the previous request. A warm server is told about each of them
   * before the request, because Haxe 4.3.7 compares file times in whole
   * seconds and would keep the old module after two saves in one second.
   */
  compile(
    invocation: BoundHaxeInvocation,
    compatibilityDigest: string,
    signal: AbortSignal,
    assertInvocationCurrent?: () => void | Promise<void>,
    prepared?: PreparedCompilerRequest,
    invalidatedFiles?: readonly string[],
  ): Promise<CompilerResult>;
  close(): Promise<void>;
}

/**
 * The OCaml runtime setting for a compiler server that the session starts:
 * a 4M-word (32 MB) minor heap instead of the 256K-word default. A large
 * program allocates many short-lived values while it is typed; with a small
 * minor heap most of them reach the major heap and make garbage collection
 * slower. A value that the host sets in the invocation environment wins.
 */
export const HAXE_SERVER_OCAMLRUNPARAM = "s=4M";

interface CommandResult {
  readonly code: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface ActiveRequest {
  readonly invocation: BoundHaxeInvocation;
  readonly signal: AbortSignal;
  readonly assertInvocationCurrent?: () => void | Promise<void>;
  readonly prepared?: PreparedCompilerRequest;
  readonly invalidatedFiles: readonly string[];
  /** False when the server was just started: its cache holds no old module. */
  invalidate: boolean;
}

/**
 * The longest wait for one `server/invalidate` answer. Haxe 4.3.7 runs a full
 * garbage collection or compaction every 10 requests, and an invalidation
 * counts as a request; on a server with a cache of several gigabytes that can
 * take seconds. A longer wait ends in a new server instead of a failed build.
 */
export const HAXE_SERVER_INVALIDATE_TIMEOUT_MS = 120_000;

/**
 * A `server/invalidate` request failed or timed out. The compiler then starts
 * a new server, whose cache is empty, instead of failing the build.
 */
class HaxeInvalidationError extends Error {
  constructor(cause: unknown) {
    super(
      `Haxe server/invalidate failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "HaxeInvalidationError";
  }
}

class HaxeCommandError extends Error {
  readonly result: CommandResult;

  constructor(result: CommandResult, candidateRoot: string) {
    const raw = `${result.stderr}\n${result.stdout}`.trim();
    const sanitized = raw.replaceAll(
      candidateRoot,
      "<private-candidate>",
    );
    super(sanitized.length === 0 ? "Haxe compilation failed" : sanitized);
    this.name = "HaxeCommandError";
    this.result = result;
  }
}

function append(previous: string, chunk: Buffer | string): string {
  return `${previous}${chunk.toString()}`.slice(-LOG_LIMIT);
}

function snapshotJson(value: HaxeInvocation["compatibilityFacts"]): HaxeInvocation["compatibilityFacts"] {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => snapshotJson(entry)));
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, snapshotJson(entry)]),
    ),
  );
}

function snapshotEnvironment(
  ...sources: readonly (
    | Readonly<Record<string, string | undefined>>
    | undefined
  )[]
): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (value !== undefined) environment[String(key)] = String(value);
    }
  }
  return Object.freeze(environment);
}

function validateInvocation(invocation: HaxeInvocation): void {
  if (invocation.executable.length === 0 || invocation.cwd.length === 0) {
    throw new Error("HaxeInvocation executable and cwd must not be empty");
  }
  if (invocation.ioPolicy !== HAXE_4_3_7_DEVELOPMENT_JS_POLICY) {
    throw new Error("HaxeInvocation uses an unsupported compiler I/O policy");
  }
  if (
    invocation.args.some(
      (argument) =>
        [
          "--wait",
          "--server-listen",
          "--server-connect",
          "--next",
          "--each",
          "--connect",
        ].some(
          (option) =>
            argument === option || argument.startsWith(`${option}=`),
        ),
    )
  ) {
    throw new Error("HaxeInvocation must not contain compiler-server flags");
  }
  const reservedDefines = [
    "genes.output",
    GENES_OUTPUT_DESCRIPTOR_DEFINE,
    GENES_DEV_INCREMENTAL_DEFINE,
    COMPILER_DATA_DEFINE,
  ];
  for (const reserved of reservedDefines) {
    if (
      invocation.args.some(
        (argument) =>
          argument === reserved ||
          argument.startsWith(`${reserved}=`) ||
          argument.startsWith(`-D${reserved}`) ||
          argument.startsWith(`--define=${reserved}`),
      )
    ) {
      throw new Error(`HaxeInvocation must not define ${reserved}`);
    }
  }
  for (let index = 0; index < invocation.args.length - 1; index += 1) {
    if (invocation.args[index] === "-D" || invocation.args[index] === "--define") {
      const value = invocation.args[index + 1]!;
      const reserved = reservedDefines.find(
        (candidate) => value === candidate || value.startsWith(`${candidate}=`),
      );
      if (reserved !== undefined) {
        throw new Error(`HaxeInvocation must not define ${reserved}`);
      }
    }
  }
}

/**
 * Copies every host-owned invocation container once, then validates the exact
 * bytes used for hashing, server startup, and compilation. A host cannot
 * mutate a retained argument or environment object after this boundary.
 */
export function snapshotHaxeInvocation(
  invocation: HaxeInvocation,
): HaxeInvocation {
  const snapshot: HaxeInvocation = Object.freeze({
    executable: String(invocation.executable),
    cwd: String(invocation.cwd),
    args: Object.freeze([...invocation.args].map((argument) => String(argument))),
    ioPolicy: invocation.ioPolicy,
    env: snapshotEnvironment(process.env, invocation.env),
    compatibilityFacts: snapshotJson(invocation.compatibilityFacts),
  });
  validateInvocation(snapshot);
  return snapshot;
}

function commandArgs(
  invocation: BoundHaxeInvocation,
  endpoint: HaxeWaitEndpoint | null,
  prepared: PreparedCompilerRequest | undefined,
): readonly string[] {
  return Object.freeze([
    ...(endpoint === null ? [] : ["--connect", endpoint.argument]),
    ...invocation.arguments,
    ...(prepared?.classPaths.flatMap((classPath) => ["-cp", classPath]) ?? []),
    ...(prepared === undefined
      ? []
      : ["-D", `genes.tooling.prepared=${prepared.digest}`]),
  ]);
}

/**
 * Sends one JSON-RPC request of the Haxe display protocol to a running
 * compiler server and returns the text of the server's answer.
 *
 * Why: some server methods do not compile anything. `server/invalidate`
 * marks the modules of one file as changed, and `server/contexts` lists the
 * caches. Starting a `haxe --connect` client process for each would cost more
 * than the request itself; this writes the request to the server socket
 * directly, in the same form as the Haxe client: one argument per line, then
 * a zero byte.
 *
 * Example: `sendHaxeServerRequest(endpoint, "/project", "server/invalidate",
 * { file: "/project/src/App.hx" }, { signal, timeoutMs: 120_000 })`.
 *
 * It rejects when the server cannot be reached, when `signal` aborts, when
 * the server does not answer within `timeoutMs` of silence, or when it
 * answers with a JSON-RPC error.
 */
export function sendHaxeServerRequest(
  endpoint: HaxeWaitEndpoint,
  cwd: string,
  method: string,
  params: Readonly<Record<string, string>>,
  options: { readonly signal?: AbortSignal; readonly timeoutMs: number },
): Promise<string> {
  const { signal, timeoutMs } = options;
  const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const payload = `${["--cwd", cwd, "--display", request]
    .map((line) => `${line}\n`)
    .join("")}\0`;
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: endpoint.host,
      port: endpoint.port,
    });
    let answer = "";
    let settled = false;
    const abort = (): void => finish(new Error(`Haxe server ${method} was cancelled`));
    const finish = (error: Error | null): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      socket.destroy();
      if (error !== null) {
        reject(error);
      } else if (!answer.includes('"result"') || answer.includes('"error"')) {
        reject(new Error(`Haxe server ${method} failed: ${answer.trim()}`));
      } else {
        resolve(answer);
      }
    };
    if (signal?.aborted === true) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    socket.setTimeout(timeoutMs, () =>
      finish(new Error(`Haxe server ${method} timed out`)),
    );
    socket.once("connect", () => socket.write(payload));
    socket.on("data", (chunk: Buffer) => {
      answer = append(answer, chunk);
    });
    socket.once("error", (error) => finish(error));
    socket.once("close", () => finish(null));
  });
}

function terminate(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    const finalTimeout = setTimeout(() => resolve(), timeoutMs * 2);
    child.once("exit", () => {
      clearTimeout(timeout);
      clearTimeout(finalTimeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function runCommand(
  invocation: BoundHaxeInvocation,
  args: readonly string[],
  signal: AbortSignal,
  shutdownTimeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Haxe compilation was cancelled"));
      return;
    }
    const launch = launchHaxe(invocation.executable, args, {
      cwd: invocation.cwd,
      environment: invocation.environment,
      stdout: "pipe",
      stderr: "pipe",
    });
    const { child } = launch;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let handoffComplete = false;
    let closedResult: CommandResult | undefined;
    const finish = (): void => {
      if (settled || !handoffComplete || closedResult === undefined) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      resolve(closedResult);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    const abort = (): void => {
      if (settled) return;
      void terminate(child, shutdownTimeoutMs).then(() => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        reject(new Error("Haxe compilation was cancelled"));
      });
    };
    signal.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code, childSignal) => {
      if (settled) return;
      if (signal.aborted) {
        settled = true;
        signal.removeEventListener("abort", abort);
        reject(new Error("Haxe compilation was cancelled"));
      } else {
        closedResult = { code, signal: childSignal, stdout, stderr };
        finish();
      }
    });
    void launch.handoff.then(
      () => {
        handoffComplete = true;
        finish();
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

class ChildWaitProcess implements OwnedHaxeWaitProcess {
  readonly pid: number;
  readonly exit: Promise<HaxeWaitProcessExit>;
  readonly #child: ChildProcess;

  constructor(child: ChildProcess) {
    if (child.pid === undefined) throw new Error("Haxe server has no PID");
    this.pid = child.pid;
    this.#child = child;
    this.exit = child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
      : new Promise((resolve) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
  }

  signal(signal: "SIGTERM" | "SIGKILL"): void {
    this.#child.kill(signal);
  }
}

/** Concrete process adapter over the exact owned-server policy object. */
export class HaxeSessionCompiler implements SessionCompiler {
  readonly #server: OwnedHaxeWaitServer<CompilerResult>;
  readonly #shutdownTimeoutMs: number;
  #request: ActiveRequest | null = null;
  #freshServers = 0;

  constructor(
    layout: SessionLayout,
    onEvent: (event: HaxeWaitServerEvent) => void,
    shutdownTimeoutMs: number,
  ) {
    this.#shutdownTimeoutMs = shutdownTimeoutMs;
    this.#server = new OwnedHaxeWaitServer<CompilerResult>({
      projectRoot: layout.projectRoot,
      leasePath: layout.serverLeaseRelative,
      projectIdentity: layout.projectIdentity,
      ownerPid: process.pid,
      isProcessAlive: (pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          return (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error as { readonly code?: string }).code === "EPERM"
          );
        }
      },
      start: (endpoint) => this.#start(endpoint),
      probe: (endpoint) => this.#probeServer(endpoint),
      compileConnected: (endpoint) => this.#compileConnected(endpoint),
      compileDirect: () => this.#compileDirect(),
      onEvent,
      shutdownTimeoutMs,
    });
  }

  async compile(
    invocation: BoundHaxeInvocation,
    compatibilityDigest: string,
    signal: AbortSignal,
    assertInvocationCurrent?: () => void | Promise<void>,
    prepared?: PreparedCompilerRequest,
    invalidatedFiles: readonly string[] = [],
  ): Promise<CompilerResult> {
    const request: ActiveRequest = {
      invocation,
      signal,
      assertInvocationCurrent,
      prepared,
      invalidatedFiles: Object.freeze([...invalidatedFiles]),
      invalidate: true,
    };
    this.#request = request;
    try {
      let digest = this.#serverDigest(compatibilityDigest);
      request.invalidate = !(await this.#server.ensure(digest)).newlyStarted;
      try {
        return await this.#server.compile(digest);
      } catch (error) {
        if (!(error instanceof HaxeInvalidationError) || signal.aborted) {
          throw error;
        }
        // The old server could not take the invalidation. A new server has
        // an empty cache, so it needs none and gives the cold result.
        this.#freshServers += 1;
        digest = this.#serverDigest(compatibilityDigest);
        request.invalidate = false;
        await this.#server.ensure(digest);
        return await this.#server.compile(digest);
      }
    } finally {
      this.#request = null;
    }
  }

  /**
   * Returns the digest that selects the owned server. It is the session's
   * compatibility digest, plus a counter of the servers replaced after a
   * failed invalidation, so that such a replacement stays in use.
   */
  #serverDigest(compatibilityDigest: string): string {
    return this.#freshServers === 0
      ? compatibilityDigest
      : `${compatibilityDigest}:fresh-${this.#freshServers}`;
  }

  async close(): Promise<void> {
    await this.#server.close();
  }

  #current(): ActiveRequest {
    if (this.#request === null) throw new Error("no active Haxe request");
    return this.#request;
  }

  async #start(endpoint: HaxeWaitEndpoint): Promise<OwnedHaxeWaitProcess> {
    const request = this.#current();
    await request.assertInvocationCurrent?.();
    if (request.signal.aborted) {
      throw new Error("Haxe compilation was cancelled");
    }
    const launch = launchHaxe(
      request.invocation.executable,
      ["--server-listen", endpoint.argument],
      {
        cwd: request.invocation.cwd,
        environment: {
          OCAMLRUNPARAM: HAXE_SERVER_OCAMLRUNPARAM,
          ...request.invocation.environment,
        },
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    await launch.handoff;
    if (request.signal.aborted) {
      await terminate(launch.child, this.#shutdownTimeoutMs);
      throw new Error("Haxe compilation was cancelled");
    }
    return new ChildWaitProcess(launch.child);
  }

  async #probeServer(endpoint: HaxeWaitEndpoint): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({
        host: endpoint.host,
        port: endpoint.port,
      });
      let settled = false;
      const finish = (available: boolean): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(available);
      };
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
      socket.setTimeout(this.#shutdownTimeoutMs, () => finish(false));
    });
  }

  async #compileConnected(endpoint: HaxeWaitEndpoint): Promise<CompilerResult> {
    const request = this.#current();
    for (const file of request.invalidate ? request.invalidatedFiles : []) {
      if (request.signal.aborted) {
        throw new Error("Haxe compilation was cancelled");
      }
      try {
        await sendHaxeServerRequest(
          endpoint,
          request.invocation.cwd,
          "server/invalidate",
          { file },
          {
            signal: request.signal,
            timeoutMs: HAXE_SERVER_INVALIDATE_TIMEOUT_MS,
          },
        );
      } catch (error) {
        if (request.signal.aborted) {
          throw new Error("Haxe compilation was cancelled");
        }
        throw new HaxeInvalidationError(error);
      }
    }
    return await this.#run(endpoint, "connected");
  }

  async #compileDirect(): Promise<CompilerResult> {
    return await this.#run(null, "direct");
  }

  async #run(
    endpoint: HaxeWaitEndpoint | null,
    mode: "connected" | "direct",
  ): Promise<CompilerResult> {
    const request = this.#current();
    await request.assertInvocationCurrent?.();
    if (request.signal.aborted) {
      throw new Error("Haxe compilation was cancelled");
    }
    const result = await runCommand(
      request.invocation,
      commandArgs(request.invocation, endpoint, request.prepared),
      request.signal,
      this.#shutdownTimeoutMs,
    );
    if (result.code !== 0) {
      throw new HaxeCommandError(result, request.invocation.candidateRoot);
    }
    return Object.freeze({ mode });
  }
}
