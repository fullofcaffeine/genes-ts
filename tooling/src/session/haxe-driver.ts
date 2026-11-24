import type { ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import net from "node:net";
import {
  OwnedHaxeWaitServer,
  type HaxeWaitLoopbackEndpoint,
  type HaxeWaitProcessExit,
  type HaxeWaitServerEvent,
  type OwnedHaxeWaitProcess,
} from "../haxe-server/index.js";
import type { CompilerServerQueryMethod, HaxeInvocation } from "./types.js";
import type { SessionLayout } from "./layout.js";
import {
  GENES_DEV_INCREMENTAL_DEFINE,
  GENES_OUTPUT_DESCRIPTOR_DEFINE,
  HAXE_4_3_7_DEVELOPMENT_JS_POLICY,
  type BoundHaxeInvocation,
} from "./effective-invocation.js";
import { COMPILER_DATA_DEFINE } from "./compiler-data.js";
import { launchHaxe } from "./haxe-launch.js";
import {
  HAXE_SERVER_COLLECTION_PERIOD,
  HaxeStdioChannel,
  HaxeStdioTransportError,
  decodeHaxeServerAnswer,
} from "./haxe-stdio-channel.js";

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

  /**
   * Runs one Haxe request in a new process that this call starts and stops,
   * never on the owned compiler server, and rejects when Haxe fails or
   * `signal` aborts (the process is then stopped).
   *
   * Why: the cold build of the output check (`GenerationReuseOptions`) needs
   * a tree that no cache produced, while the warm server keeps its cache.
   * Optional, so that an adapter without it simply has no cold build.
   */
  compileCold?(
    invocation: BoundHaxeInvocation,
    signal: AbortSignal,
    prepared?: PreparedCompilerRequest,
  ): Promise<void>;

  /**
   * Sends one read-only JSON-RPC request of Haxe's display protocol (see
   * `COMPILER_SERVER_QUERY_METHODS`) to the owned server and returns the
   * answer text, or null when no server runs. Optional: an adapter without
   * it has nothing to ask.
   */
  query?(
    method: CompilerServerQueryMethod,
    signal?: AbortSignal,
  ): Promise<string | null>;

  close(): Promise<void>;
}

/** Every `CompilerServerQueryMethod`, for the check at run time. */
const COMPILER_SERVER_QUERY_METHODS: readonly CompilerServerQueryMethod[] =
  Object.freeze(["server/contexts"]);

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
 * How long the owned server must be idle before the compiler sends the
 * requests that compile nothing (see `HaxeSessionCompiler`). An edit that
 * arrives in this time finds no collection in its way.
 */
export const HAXE_SERVER_IDLE_COLLECTION_DELAY_MS = 250;

/**
 * Idle requests are sent only when fewer requests than this remain before
 * the next multiple of `HAXE_SERVER_COLLECTION_PERIOD`: about the most that
 * one build sends (the compile request, a `server/invalidate` or two, a
 * query). So Haxe collects as often as before (about once in 5 to 10
 * builds), and a build never starts so close to the boundary that the
 * collection runs between its requests.
 */
export const HAXE_SERVER_BUILD_REQUEST_ALLOWANCE = 4;

/**
 * After this many failures of the stdio channel in a row, the compiler stops
 * starting new servers for the same compatibility digest and builds in a
 * new Haxe process for each request (`direct` mode), as it does for a
 * server that does not answer.
 */
const MAX_TRANSPORT_FAILURES = 2;

/** Optional settings of `HaxeSessionCompiler`; tests use small values. */
export interface HaxeSessionCompilerOptions {
  /** False sends no idle requests. Default true. */
  readonly idleCollection?: boolean;
  /** See `HAXE_SERVER_IDLE_COLLECTION_DELAY_MS`. */
  readonly idleCollectionDelayMs?: number;
  /** Passed to the channel; see `HaxeStdioChannelOptions`. */
  readonly frameStallMs?: number;
}

/**
 * The request counts of the owned server, for tests and measurements.
 *
 * `requests` counts every request that this server got, `idleRequests` only
 * the requests that compile nothing, which the compiler sends while the
 * server is idle so that Haxe's periodic collection runs then.
 */
export interface HaxeServerRequestCounts {
  readonly pid: number;
  readonly requests: number;
  readonly idleRequests: number;
}

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
  prepared: PreparedCompilerRequest | undefined,
): readonly string[] {
  return Object.freeze([
    ...invocation.arguments,
    ...(prepared?.classPaths.flatMap((classPath) => ["-cp", classPath]) ?? []),
    ...(prepared === undefined
      ? []
      : ["-D", `genes.tooling.prepared=${prepared.digest}`]),
  ]);
}

/**
 * The lines of one JSON-RPC request of the Haxe display protocol, in the
 * form that the Haxe client sends: `--cwd`, the folder, `--display`, the
 * request.
 */
function displayRequestLines(
  cwd: string,
  method: string,
  params: Readonly<Record<string, string>>,
): readonly string[] {
  const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  return ["--cwd", cwd, "--display", request];
}

/** Checks a display answer as `sendHaxeServerRequest` does. */
function checkDisplayAnswer(method: string, answer: string): string {
  if (!answer.includes('"result"') || answer.includes('"error"')) {
    throw new Error(`Haxe server ${method} failed: ${answer.trim()}`);
  }
  return answer;
}

/**
 * Sends one JSON-RPC request of the Haxe display protocol to a running
 * compiler server on a loopback port (`haxe --wait PORT`) and returns the
 * text of the server's answer.
 *
 * Why: some server methods do not compile anything. `server/invalidate`
 * marks the modules of one file as changed, and `server/contexts` lists the
 * caches. Starting a `haxe --connect` client process for each would cost more
 * than the request itself; this writes the request to the server socket
 * directly, in the same form as the Haxe client: one argument per line, then
 * a zero byte. The development session itself does not use it: its server
 * takes requests on a pipe (`HaxeSessionCompiler`).
 *
 * Example: `sendHaxeServerRequest(endpoint, "/project", "server/invalidate",
 * { file: "/project/src/App.hx" }, { signal, timeoutMs: 120_000 })`.
 *
 * It rejects when the server cannot be reached, when `signal` aborts, when
 * the server does not answer within `timeoutMs` of silence, or when it
 * answers with a JSON-RPC error.
 */
export function sendHaxeServerRequest(
  endpoint: HaxeWaitLoopbackEndpoint,
  cwd: string,
  method: string,
  params: Readonly<Record<string, string>>,
  options: { readonly signal?: AbortSignal; readonly timeoutMs: number },
): Promise<string> {
  const { signal, timeoutMs } = options;
  const payload = `${displayRequestLines(cwd, method, params)
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
      } else {
        try {
          resolve(checkDisplayAnswer(method, answer));
        } catch (failure) {
          reject(failure);
        }
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

/** One started stdio server: its process, its channel and its counts. */
interface StdioServer {
  readonly child: ChildProcess;
  readonly channel: HaxeStdioChannel;
  /** The physical working folder, as the Haxe client sends it in `--cwd`. */
  readonly cwd: string;
  /** True after the server answered its first request. */
  answered: boolean;
  idleRequests: number;
}

/**
 * The development session's compiler: one owned `haxe --wait stdio` server,
 * reached through one pipe that stays open.
 *
 * What it does for each build:
 *
 * 1. `server/invalidate` for each file that Haxe cannot see as changed (see
 *    `SessionCompiler.compile`), then the compile request, each as one frame
 *    on the pipe (`HaxeStdioChannel`). The request has the same arguments
 *    and the same `--cwd` as a `haxe --connect` client would send, so the
 *    output is the same as before; only the transport changed.
 * 2. When the server stays idle for `HAXE_SERVER_IDLE_COLLECTION_DELAY_MS`
 *    and fewer than `HAXE_SERVER_BUILD_REQUEST_ALLOWANCE` requests remain
 *    before the next multiple of `HAXE_SERVER_COLLECTION_PERIOD`, it sends
 *    `-version` requests, which compile nothing, up to that multiple. Haxe
 *    then runs its periodic full collection or compaction at once, while
 *    nobody waits, instead of between the requests of the next build. On a
 *    large cache that collection takes seconds. Further from the boundary
 *    it sends nothing, so Haxe collects as often as before.
 *
 * When the pipe fails (for example a macro wrote to standard error directly,
 * so bytes arrived outside a frame), the compiler stops that server and
 * builds again on a new one, which gives the cold result. After
 * `MAX_TRANSPORT_FAILURES` failures in a row it builds in a new Haxe process
 * for each request instead.
 *
 * Cold builds of the output check (`compileCold`) and the fallback without a
 * server (`direct` mode) still start one Haxe process for each request.
 */
export class HaxeSessionCompiler implements SessionCompiler {
  readonly #server: OwnedHaxeWaitServer<CompilerResult>;
  readonly #shutdownTimeoutMs: number;
  readonly #idleCollection: boolean;
  readonly #idleCollectionDelayMs: number;
  readonly #frameStallMs: number | undefined;
  readonly #onEvent: (event: HaxeWaitServerEvent) => void;
  #request: ActiveRequest | null = null;
  #freshServers = 0;
  #transportFailures = 0;
  #stdio: StdioServer | null = null;
  #idleTimer: NodeJS.Timeout | null = null;
  #closed = false;

  constructor(
    layout: SessionLayout,
    onEvent: (event: HaxeWaitServerEvent) => void,
    shutdownTimeoutMs: number,
    options: HaxeSessionCompilerOptions = {},
  ) {
    this.#shutdownTimeoutMs = shutdownTimeoutMs;
    this.#onEvent = onEvent;
    this.#idleCollection = options.idleCollection ?? true;
    this.#idleCollectionDelayMs =
      options.idleCollectionDelayMs ?? HAXE_SERVER_IDLE_COLLECTION_DELAY_MS;
    this.#frameStallMs = options.frameStallMs;
    this.#server = new OwnedHaxeWaitServer<CompilerResult>({
      projectRoot: layout.projectRoot,
      leasePath: layout.serverLeaseRelative,
      projectIdentity: layout.projectIdentity,
      ownerPid: process.pid,
      transport: "stdio",
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
      start: () => this.#start(),
      probe: () => this.#probeServer(),
      compileConnected: () => this.#compileConnected(),
      compileDirect: () => this.#compileDirect(),
      onEvent,
      shutdownTimeoutMs,
    });
  }

  /**
   * The request counts of the running server, or null when none runs. Tests
   * and measurements use it to check when Haxe's periodic collection runs.
   */
  get serverRequests(): HaxeServerRequestCounts | null {
    const server = this.#stdio;
    if (server === null || server.child.pid === undefined) return null;
    return Object.freeze({
      pid: server.child.pid,
      requests: server.channel.requests,
      idleRequests: server.idleRequests,
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
    this.#cancelIdleCollection();
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
      for (let attempt = 0; ; attempt += 1) {
        try {
          const result = await this.#server.compile(digest);
          if (result.mode === "connected") this.#transportFailures = 0;
          return result;
        } catch (error) {
          if (signal.aborted || attempt >= MAX_TRANSPORT_FAILURES) throw error;
          if (error instanceof HaxeStdioTransportError) {
            this.#transportFailures += 1;
            // The next attempt finds the same broken server, which then
            // reports that it cannot answer, so the build runs direct.
            if (this.#transportFailures >= MAX_TRANSPORT_FAILURES) continue;
          } else if (!(error instanceof HaxeInvalidationError)) {
            throw error;
          }
          // The old server cannot be used. A new server has an empty cache,
          // so it needs no invalidation and gives the cold result.
          this.#freshServers += 1;
          digest = this.#serverDigest(compatibilityDigest);
          request.invalidate = false;
          await this.#server.ensure(digest);
        }
      }
    } finally {
      this.#request = null;
      this.#scheduleIdleCollection();
    }
  }

  /**
   * Returns the digest that selects the owned server. It is the session's
   * compatibility digest, plus a counter of the servers replaced after a
   * failed invalidation or a failed pipe, so that such a replacement stays
   * in use.
   */
  #serverDigest(compatibilityDigest: string): string {
    return this.#freshServers === 0
      ? compatibilityDigest
      : `${compatibilityDigest}:fresh-${this.#freshServers}`;
  }

  async compileCold(
    invocation: BoundHaxeInvocation,
    signal: AbortSignal,
    prepared?: PreparedCompilerRequest,
  ): Promise<void> {
    const result = await runCommand(
      invocation,
      commandArgs(invocation, prepared),
      signal,
      this.#shutdownTimeoutMs,
    );
    if (result.code !== 0) {
      throw new HaxeCommandError(result, invocation.candidateRoot);
    }
  }

  async query(
    method: CompilerServerQueryMethod,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (!COMPILER_SERVER_QUERY_METHODS.includes(method)) {
      throw new Error(`Haxe server method ${String(method)} is not a query`);
    }
    const server = this.#stdio;
    if (server === null || server.channel.broken !== null) return null;
    try {
      const body = await server.channel.request(
        displayRequestLines(server.cwd, method, {}),
        signal,
      );
      return checkDisplayAnswer(method, body.toString("utf8"));
    } finally {
      if (this.#request === null) this.#scheduleIdleCollection();
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#cancelIdleCollection();
    await this.#server.close();
    this.#stdio?.channel.close();
    this.#stdio = null;
  }

  #current(): ActiveRequest {
    if (this.#request === null) throw new Error("no active Haxe request");
    return this.#request;
  }

  async #start(): Promise<OwnedHaxeWaitProcess> {
    const request = this.#current();
    await request.assertInvocationCurrent?.();
    if (request.signal.aborted) {
      throw new Error("Haxe compilation was cancelled");
    }
    // The Haxe client sends its physical working folder, so this does too.
    const cwd = realpathSync.native(request.invocation.cwd);
    const launch = launchHaxe(
      request.invocation.executable,
      ["--wait", "stdio"],
      {
        cwd: request.invocation.cwd,
        environment: {
          OCAMLRUNPARAM: HAXE_SERVER_OCAMLRUNPARAM,
          ...request.invocation.environment,
        },
        stdin: "pipe",
        stdout: "ignore",
        stderr: "pipe",
      },
    );
    const { child } = launch;
    // Errors of the pipes reach the channel; this only keeps a write to a
    // closed pipe during the handoff from becoming an unhandled error.
    child.stdin?.on("error", () => {});
    await launch.handoff;
    if (request.signal.aborted) {
      await terminate(child, this.#shutdownTimeoutMs);
      throw new Error("Haxe compilation was cancelled");
    }
    if (child.stdin === null || child.stderr === null) {
      await terminate(child, this.#shutdownTimeoutMs);
      throw new Error("Haxe server has no standard streams");
    }
    this.#stdio?.channel.close();
    child.once("exit", () => {
      if (this.#stdio?.child === child) {
        this.#stdio.channel.close();
        this.#stdio = null;
      }
      // Release this end of the pipes only after the exit: Haxe 4.3.7's
      // stdio server does not stop at the end of its input, it writes an
      // error frame for each failed read in a tight loop.
      child.stdin?.destroy();
      child.stderr?.destroy();
    });
    this.#stdio = {
      child,
      channel: new HaxeStdioChannel(child.stdin, child.stderr, {
        frameStallMs: this.#frameStallMs,
        onBroken: (error) => {
          // A pipe that the session closed itself is no failure to report.
          if (this.#closed || error.reason === "the channel was closed") return;
          try {
            this.#onEvent(
              Object.freeze({
                kind: "transport-failed",
                reason: error.reason,
                firstBytes: error.firstBytes,
              }),
            );
          } catch {
            // Reporting must not change the compiler state.
          }
        },
      }),
      cwd,
      answered: false,
      idleRequests: 0,
    };
    return new ChildWaitProcess(child);
  }

  /**
   * Readiness and liveness of the stdio server. The first call waits for
   * the answer of a request that compiles nothing. Later calls only check
   * the process: a request would wait behind a running compile.
   *
   * A broken pipe on a live process counts as available while a new server
   * may still be tried, so that `compile` gets the error and starts one.
   */
  async #probeServer(): Promise<boolean> {
    const server = this.#stdio;
    if (
      server === null ||
      server.child.exitCode !== null ||
      server.child.signalCode !== null
    ) {
      return false;
    }
    if (server.channel.broken !== null) {
      return this.#transportFailures < MAX_TRANSPORT_FAILURES;
    }
    if (server.answered) return true;
    try {
      await server.channel.request(this.#noOpLines(server));
      server.answered = true;
      return true;
    } catch {
      return (
        server.channel.broken !== null &&
        this.#transportFailures < MAX_TRANSPORT_FAILURES
      );
    }
  }

  async #compileConnected(): Promise<CompilerResult> {
    const request = this.#current();
    const server = this.#stdio;
    if (server === null) throw new Error("Haxe server is not running");
    if (server.channel.broken !== null) throw server.channel.broken;
    for (const file of request.invalidate ? request.invalidatedFiles : []) {
      if (request.signal.aborted) {
        throw new Error("Haxe compilation was cancelled");
      }
      try {
        const body = await server.channel.request(
          displayRequestLines(server.cwd, "server/invalidate", { file }),
          AbortSignal.any([
            request.signal,
            AbortSignal.timeout(HAXE_SERVER_INVALIDATE_TIMEOUT_MS),
          ]),
        );
        checkDisplayAnswer("server/invalidate", body.toString("utf8"));
      } catch (error) {
        if (request.signal.aborted) {
          throw new Error("Haxe compilation was cancelled");
        }
        if (error instanceof HaxeStdioTransportError) throw error;
        throw new HaxeInvalidationError(error);
      }
    }
    await request.assertInvocationCurrent?.();
    if (request.signal.aborted) {
      throw new Error("Haxe compilation was cancelled");
    }
    const body = await server.channel.request(
      [
        `--cwd ${server.cwd}`,
        ...commandArgs(request.invocation, request.prepared),
      ],
      request.signal,
    );
    const answer = decodeHaxeServerAnswer(body.toString("utf8"));
    if (answer.failed) {
      throw new HaxeCommandError(
        {
          code: 1,
          signal: null,
          stdout: answer.stdout.slice(-LOG_LIMIT),
          stderr: answer.stderr.slice(-LOG_LIMIT),
        },
        request.invocation.candidateRoot,
      );
    }
    return Object.freeze({ mode: "connected" });
  }

  async #compileDirect(): Promise<CompilerResult> {
    const request = this.#current();
    await request.assertInvocationCurrent?.();
    if (request.signal.aborted) {
      throw new Error("Haxe compilation was cancelled");
    }
    const result = await runCommand(
      request.invocation,
      commandArgs(request.invocation, request.prepared),
      request.signal,
      this.#shutdownTimeoutMs,
    );
    if (result.code !== 0) {
      throw new HaxeCommandError(result, request.invocation.candidateRoot);
    }
    return Object.freeze({ mode: "direct" });
  }

  /** A request that compiles nothing: Haxe prints its version. */
  #noOpLines(server: StdioServer): readonly string[] {
    return [`--cwd ${server.cwd}`, "-version"];
  }

  #scheduleIdleCollection(): void {
    this.#cancelIdleCollection();
    if (this.#closed || !this.#idleCollection) return;
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = null;
      void this.#collectWhileIdle();
    }, this.#idleCollectionDelayMs);
    this.#idleTimer.unref();
  }

  #cancelIdleCollection(): void {
    if (this.#idleTimer !== null) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
    }
  }

  /**
   * Sends requests that compile nothing until the request count of the
   * server is a multiple of `HAXE_SERVER_COLLECTION_PERIOD`, but only when
   * fewer than `HAXE_SERVER_BUILD_REQUEST_ALLOWANCE` requests remain before
   * it. Haxe runs its collection right after the last of them. It stops as
   * soon as a build starts, so a build waits for one small request at most,
   * or for a collection that had already started.
   */
  async #collectWhileIdle(): Promise<void> {
    const server = this.#stdio;
    if (server === null) return;
    const remaining =
      HAXE_SERVER_COLLECTION_PERIOD -
      (server.channel.requests % HAXE_SERVER_COLLECTION_PERIOD);
    if (
      remaining === HAXE_SERVER_COLLECTION_PERIOD ||
      remaining >= HAXE_SERVER_BUILD_REQUEST_ALLOWANCE
    ) {
      return;
    }
    while (
      !this.#closed &&
      this.#request === null &&
      this.#stdio === server &&
      server.channel.broken === null &&
      !server.channel.busy &&
      server.channel.requests % HAXE_SERVER_COLLECTION_PERIOD !== 0
    ) {
      try {
        server.idleRequests += 1;
        await server.channel.request(this.#noOpLines(server));
      } catch {
        // A broken pipe is found again by the next build, which replaces
        // the server.
        return;
      }
    }
  }
}
