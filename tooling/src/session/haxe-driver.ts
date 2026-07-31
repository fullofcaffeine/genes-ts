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

const LOG_LIMIT = 128_000;

export interface CompilerResult {
  readonly mode: "connected" | "direct";
}

export interface SessionCompiler {
  compile(
    invocation: HaxeInvocation,
    compatibilityDigest: string,
    candidateOutputFile: string,
    signal: AbortSignal,
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
  readonly invocation: HaxeInvocation;
  readonly candidateOutputFile: string;
  readonly signal: AbortSignal;
}

class HaxeCommandError extends Error {
  readonly result: CommandResult;

  constructor(result: CommandResult, candidateOutputFile: string) {
    const raw = `${result.stderr}\n${result.stdout}`.trim();
    const sanitized = raw.replaceAll(
      path.dirname(candidateOutputFile),
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

function validateInvocation(invocation: HaxeInvocation): void {
  if (invocation.executable.length === 0 || invocation.cwd.length === 0) {
    throw new Error("HaxeInvocation executable and cwd must not be empty");
  }
  if (
    invocation.args.some(
      (argument) =>
        argument === "--wait" ||
        argument === "--server-listen" ||
        argument === "--server-connect" ||
        argument === "--connect" ||
        argument.startsWith("--connect="),
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

function commandArgs(
  invocation: HaxeInvocation,
  candidateOutputFile: string,
  endpoint: HaxeWaitEndpoint | null,
): readonly string[] {
  return Object.freeze([
    ...(endpoint === null ? [] : ["--connect", endpoint.argument]),
    ...invocation.args,
    "-D",
    `genes.output=${candidateOutputFile}`,
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
  invocation: HaxeInvocation,
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
      env: { ...process.env, ...invocation.env },
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
    invocation: HaxeInvocation,
    compatibilityDigest: string,
    candidateOutputFile: string,
    signal: AbortSignal,
  ): Promise<CompilerResult> {
    validateInvocation(invocation);
    this.#request = { invocation, candidateOutputFile, signal };
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
        env: { ...process.env, ...invocation.env },
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
    const result = await runCommand(
      request.invocation,
      commandArgs(request.invocation, request.candidateOutputFile, endpoint),
      request.signal,
      this.#shutdownTimeoutMs,
    );
    if (result.code !== 0) {
      throw new HaxeCommandError(result, request.candidateOutputFile);
    }
    return Object.freeze({ mode });
  }
}
