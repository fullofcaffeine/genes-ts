import { spawn, type ChildProcess } from "node:child_process";
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
  HAXE_4_3_7_DEVELOPMENT_JS_POLICY,
  type BoundHaxeInvocation,
} from "./effective-invocation.js";

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
  compile(
    invocation: BoundHaxeInvocation,
    compatibilityDigest: string,
    signal: AbortSignal,
    assertInvocationCurrent?: () => void | Promise<void>,
    prepared?: PreparedCompilerRequest,
  ): Promise<CompilerResult>;
  close(): Promise<void>;
}

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
  if (
    invocation.args.some(
      (argument) =>
        argument === "genes.output" ||
        argument.startsWith("genes.output=") ||
        argument.startsWith("-Dgenes.output") ||
        argument.startsWith("--define=genes.output"),
    )
  ) {
    throw new Error("HaxeInvocation must not define genes.output");
  }
  for (let index = 0; index < invocation.args.length - 1; index += 1) {
    if (
      (invocation.args[index] === "-D" ||
        invocation.args[index] === "--define") &&
      invocation.args[index + 1]!.startsWith("genes.output")
    ) {
      throw new Error("HaxeInvocation must not define genes.output");
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
    const child = spawn(invocation.executable, [...args], {
      cwd: invocation.cwd,
      env: invocation.environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
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
      settled = true;
      signal.removeEventListener("abort", abort);
      if (signal.aborted) {
        reject(new Error("Haxe compilation was cancelled"));
      } else {
        resolve({ code, signal: childSignal, stdout, stderr });
      }
    });
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
    this.exit = new Promise((resolve) => {
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
  ): Promise<CompilerResult> {
    this.#request = {
      invocation,
      signal,
      assertInvocationCurrent,
      prepared,
    };
    try {
      await this.#server.ensure(compatibilityDigest);
      return await this.#server.compile(compatibilityDigest);
    } finally {
      this.#request = null;
    }
  }

  async close(): Promise<void> {
    await this.#server.close();
  }

  #current(): ActiveRequest {
    if (this.#request === null) throw new Error("no active Haxe request");
    return this.#request;
  }

  #start(endpoint: HaxeWaitEndpoint): Promise<OwnedHaxeWaitProcess> {
    const { invocation } = this.#current();
    const child = spawn(
      invocation.executable,
      ["--server-listen", endpoint.argument],
      {
        cwd: invocation.cwd,
        env: invocation.environment,
        shell: false,
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    return new Promise((resolve, reject) => {
      child.once("spawn", () => resolve(new ChildWaitProcess(child)));
      child.once("error", reject);
    });
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
