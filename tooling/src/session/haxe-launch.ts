import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnSyncReturns,
} from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net, { type Server, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HAXE_ENVIRONMENT_PAYLOAD_LIMIT,
  HAXE_ENVIRONMENT_TEXT_LIMIT,
} from "./haxe-exec-contract.js";

const RUNNER = fileURLToPath(new URL("./haxe-exec-runner.js", import.meta.url));
const HANDOFF_LIMIT = 4_096;
const CONTROL_DIRECTORY_PREFIX = "genes-haxe-exec-";

type OutputMode = "ignore" | "pipe";

export interface HaxeLaunchOptions {
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly stdout: OutputMode;
  readonly stderr: OutputMode;
}

export interface HaxeSyncOptions {
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface HaxeLaunch {
  readonly child: ChildProcess;
  /** Resolves after the trusted child has attempted the raw-exec handoff. */
  readonly handoff: Promise<void>;
}

export class HaxeLaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HaxeLaunchError";
  }
}

function assertExecutable(executable: string): void {
  if (!path.isAbsolute(executable)) {
    throw new HaxeLaunchError("Haxe executable must be an absolute path");
  }
  if (process.platform === "win32" && !executable.toLowerCase().endsWith(".exe")) {
    throw new HaxeLaunchError("Haxe executable must be a native .exe on Windows");
  }
}

function environmentBytes(
  environment: Readonly<Record<string, string>>,
): string {
  let textBytes = 0;
  for (const [key, value] of Object.entries(environment)) {
    textBytes += Buffer.byteLength(key) + Buffer.byteLength(value);
    if (textBytes > HAXE_ENVIRONMENT_TEXT_LIMIT) {
      throw new HaxeLaunchError(
        "Haxe launch environment exceeds its text byte limit",
      );
    }
  }
  const payload = JSON.stringify(environment);
  if (Buffer.byteLength(payload) > HAXE_ENVIRONMENT_PAYLOAD_LIMIT) {
    throw new HaxeLaunchError(
      "Haxe launch environment exceeds its serialized byte limit",
    );
  }
  return payload;
}

function directHandoff(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

export interface RawExecControl {
  readonly path: string;
  readonly handoff: (child: ChildProcess) => Promise<void>;
}

/** Creates one private control channel for a POSIX raw-exec launch. */
export function createRawExecControl(): RawExecControl {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), CONTROL_DIRECTORY_PREFIX),
  );
  const controlPath = path.join(directory, "control.sock");
  const server = net.createServer();
  server.maxConnections = 1;
  server.listen(controlPath);
  let bound = false;
  return Object.freeze({
    path: controlPath,
    handoff(child: ChildProcess): Promise<void> {
      if (bound) {
        child.kill();
        return Promise.reject(
          new HaxeLaunchError("Haxe raw-exec control was already used"),
        );
      }
      bound = true;
      return rawExecHandoff(child, server, directory);
    },
  });
}

function rawExecHandoff(
  child: ChildProcess,
  server: Server,
  directory: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    let socket: Socket | null = null;
    const cleanup = (): void => {
      if (server.listening) server.close();
      socket?.destroy();
      try {
        rmSync(directory, { force: true, recursive: true });
      } catch {
        // Handoff evidence remains authoritative if temporary cleanup fails.
      }
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      child.kill();
      cleanup();
      const message = error instanceof Error ? error.message : String(error);
      reject(new HaxeLaunchError(message));
    };
    const rejectRunnerFailure = (detail: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new HaxeLaunchError(`Haxe raw-exec failed: ${detail}`));
    };
    if (child.stdin === null) {
      fail("Haxe raw-exec input pipe is unavailable");
      return;
    }
    child.stdin.once("error", fail);
    server.once("error", fail);
    server.once("connection", (connection) => {
      socket = connection;
      server.close();
      connection.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > HANDOFF_LIMIT) {
          fail("Haxe raw-exec handoff exceeded its byte limit");
          return;
        }
        chunks.push(chunk);
      });
      connection.once("error", fail);
      connection.once("end", () => {
        if (settled) return;
        const transcript = Buffer.concat(chunks).toString("utf8");
        if (transcript === "READY\n") {
          settled = true;
          cleanup();
          resolve();
          return;
        }
        if (transcript.startsWith("READY\nERROR ")) {
          rejectRunnerFailure(transcript.slice("READY\nERROR ".length).trim());
          return;
        }
        if (transcript.startsWith("ERROR ")) {
          rejectRunnerFailure(transcript.slice("ERROR ".length).trim());
          return;
        }
        fail("Haxe raw-exec failed: the handoff did not confirm raw exec");
      });
    });
    child.once("error", fail);
    child.once("close", (code, signal) => {
      if (settled) return;
      if (socket === null) {
        fail(
          `Haxe raw-exec exited before control: status ${String(code)}, signal ${String(signal)}`,
        );
      }
    });
  });
}

/**
 * Starts one structured Haxe child without a shell or PATH lookup.
 *
 * On POSIX, the trusted Node 26.1+ child first proves failed exec is
 * recoverable before it receives the Haxe environment. It then replaces
 * itself through `execve`, so the returned PID becomes Haxe and an `ENOEXEC`
 * target is never interpreted as a script. Child exit or server readiness
 * remains the final success evidence. Windows creates the canonical native
 * `.exe` directly.
 */
export function launchHaxe(
  executable: string,
  args: readonly string[],
  options: HaxeLaunchOptions,
): HaxeLaunch {
  assertExecutable(executable);
  const environment = environmentBytes(options.environment);
  if (process.platform === "win32") {
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.environment,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", options.stdout, options.stderr],
    });
    return Object.freeze({ child, handoff: directHandoff(child) });
  }

  const control = createRawExecControl();
  const child = spawn(
    process.execPath,
    [
      RUNNER,
      control.path,
      String(Buffer.byteLength(environment)),
      executable,
      ...args,
    ],
    {
      cwd: options.cwd,
      // The exact Haxe environment crosses stdin after Node has initialized.
      // This prevents NODE_OPTIONS and loader variables intended for Haxe from
      // changing the trusted handoff process itself.
      env: {},
      shell: false,
      windowsHide: true,
      stdio: ["pipe", options.stdout, options.stderr],
    },
  );
  const handoff = control.handoff(child);
  child.stdin!.end(environment, "utf8");
  return Object.freeze({ child, handoff });
}

/** Runs a bounded synchronous Haxe command through the same launch authority. */
export function runHaxeSync(
  executable: string,
  args: readonly string[],
  options: HaxeSyncOptions,
): SpawnSyncReturns<string> {
  assertExecutable(executable);
  const environment = environmentBytes(options.environment);
  const common = {
    cwd: options.cwd,
    encoding: "utf8" as const,
    shell: false,
    timeout: options.timeoutMs,
    windowsHide: true,
  };
  if (process.platform === "win32") {
    return spawnSync(executable, [...args], {
      ...common,
      env: options.environment,
    });
  }
  return spawnSync(
    process.execPath,
    [
      RUNNER,
      "-",
      String(Buffer.byteLength(environment)),
      executable,
      ...args,
    ],
    {
      ...common,
      env: {},
      input: environment,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}
