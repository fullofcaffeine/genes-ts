import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnSyncReturns,
} from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER = fileURLToPath(new URL("./haxe-exec-runner.js", import.meta.url));
const HANDOFF_LIMIT = 4_096;

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
  return JSON.stringify(environment);
}

function directHandoff(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

function rawExecHandoff(child: ChildProcess): Promise<void> {
  const control = child.stdio[3];
  const input = child.stdin;
  if (control === undefined || control === null || input === null) {
    child.kill();
    return Promise.reject(
      new HaxeLaunchError("Haxe raw-exec handoff pipes are unavailable"),
    );
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      const message = error instanceof Error ? error.message : String(error);
      reject(new HaxeLaunchError(message));
    };
    control.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > HANDOFF_LIMIT) {
        child.kill();
        fail("Haxe raw-exec handoff exceeded its byte limit");
        return;
      }
      chunks.push(chunk);
    });
    control.once("error", fail);
    child.once("error", fail);
    control.once("end", () => {
      if (settled) return;
      settled = true;
      const transcript = Buffer.concat(chunks).toString("utf8");
      if (transcript === "READY\n") {
        resolve();
        return;
      }
      const detail = transcript.startsWith("READY\nERROR ")
        ? transcript.slice("READY\nERROR ".length).trim()
        : transcript.startsWith("ERROR ")
          ? transcript.slice("ERROR ".length).trim()
          : "the handoff did not confirm raw exec";
      reject(new HaxeLaunchError(`Haxe raw-exec failed: ${detail}`));
    });
    input.once("error", fail);
  });
}

/**
 * Starts one structured Haxe child without a shell or PATH lookup.
 *
 * On POSIX, the trusted Node child replaces itself through `execve`, so the
 * returned PID becomes Haxe and an `ENOEXEC` target is never interpreted as a
 * script. Child exit or server readiness remains the final success evidence.
 * Windows creates the canonical native `.exe` directly.
 */
export function launchHaxe(
  executable: string,
  args: readonly string[],
  options: HaxeLaunchOptions,
): HaxeLaunch {
  assertExecutable(executable);
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

  const child = spawn(process.execPath, [RUNNER, executable, ...args], {
    cwd: options.cwd,
    // The exact Haxe environment crosses stdin after Node has initialized.
    // This prevents NODE_OPTIONS and loader variables intended for Haxe from
    // changing the trusted handoff process itself.
    env: {},
    shell: false,
    windowsHide: true,
    stdio: ["pipe", options.stdout, options.stderr, "pipe"],
  });
  const handoff = rawExecHandoff(child);
  child.stdin!.end(environmentBytes(options.environment), "utf8");
  return Object.freeze({ child, handoff });
}

/** Runs a bounded synchronous Haxe command through the same launch authority. */
export function runHaxeSync(
  executable: string,
  args: readonly string[],
  options: HaxeSyncOptions,
): SpawnSyncReturns<string> {
  assertExecutable(executable);
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
  return spawnSync(process.execPath, [RUNNER, executable, ...args], {
    ...common,
    env: {},
    input: environmentBytes(options.environment),
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  });
}
