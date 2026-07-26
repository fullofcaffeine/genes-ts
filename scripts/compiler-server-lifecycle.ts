import { ok } from "node:assert";
import {
  execFileSync,
  spawn,
  type ChildProcess
} from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const logLimit = 64_000;

export type ProcessResult = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
};

export type TreeEntry = {
  readonly path: string;
  readonly sha256: string;
};

export type HaxeCompilerSelection = {
  readonly binary: string;
  readonly version: string;
};

type SignalCleanup = {
  readonly dispose: () => void;
};

function appendLog(previous: string, chunk: Buffer | string): string {
  return `${previous}${chunk.toString()}`.slice(-logLimit);
}

/** Waits for one exact child process to exit without polling the process table. */
function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

/**
 * Terminates one child created by this harness and proves that exact PID died.
 *
 * Why: compiler-server tests must never discover or kill an ambient Haxe
 * process. They also must not leave their own server behind when a test fails.
 *
 * What/How: the child receives `SIGTERM`, then `SIGKILL` after a bounded grace
 * period. The awaited `exit` event proves Node reaped the child; POSIX `kill(0)`
 * provides an additional exact-PID liveness check. Windows keeps the reaped
 * child assertion but omits the POSIX-only probe.
 */
export async function terminateOwnedChild(
  child: ChildProcess,
  label: string,
  graceMs = 2_000
): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    if (!await waitForExit(child, graceMs)) {
      child.kill("SIGKILL");
      ok(
        await waitForExit(child, graceMs),
        `${label} did not exit after SIGKILL`
      );
    }
  }

  const pid = child.pid;
  if (pid !== undefined && process.platform !== "win32") {
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    ok(!alive, `${label} process ${pid} is still alive`);
  }
}

/**
 * Runs a bounded subprocess and returns its complete exit result.
 *
 * The timeout is a test failure, not a synthetic compiler diagnostic. The
 * helper kills and reaps the exact child before rejecting so a hung client
 * cannot outlive its test or hold the compiler-server socket open.
 */
export function runBoundedProcess(
  command: string,
  args: ReadonlyArray<string>,
  options: {
    readonly cwd: string;
    readonly timeoutMs: number;
    readonly label: string;
    readonly env?: NodeJS.ProcessEnv;
  }
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendLog(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendLog(stderr, chunk);
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      void terminateOwnedChild(child, options.label).then(
        () => reject(new Error(
          `${options.label} timed out after ${options.timeoutMs}ms`
          + `\nstdout:\n${stdout}\nstderr:\n${stderr}`
        )),
        reject
      );
    }, options.timeoutMs);

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    // `close` follows `exit` after both output pipes have closed, so diagnostics
    // cannot lose their final buffered bytes.
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

/**
 * Resolves the real Haxe binary selected by the current Lix environment.
 *
 * A package-manager shim is suitable for ordinary commands but cannot be
 * started with Haxe's native `--server-listen` protocol. When `HAXE_STD_PATH`
 * is explicit (notably the preview lane), the binary beside that standard
 * library wins. Otherwise the active wrapper's version selects
 * `~/haxe/versions/<version>/haxe`.
 */
export function selectedHaxeCompiler(repoRoot: string): HaxeCompilerSelection {
  const executable = process.platform === "win32" ? "haxe.exe" : "haxe";
  const explicitStdPath = process.env.HAXE_STD_PATH;
  const wrapperVersion = explicitStdPath === undefined
    ? execFileSync("haxe", ["--version"], {
        cwd: repoRoot,
        encoding: "utf8"
      }).trim()
    : null;
  const binary = explicitStdPath !== undefined
    ? path.join(path.dirname(explicitStdPath), executable)
    : path.join(
        homedir(),
        "haxe",
        "versions",
        wrapperVersion ?? "",
        executable
      );
  ok(existsSync(binary), `Selected Haxe compiler does not exist: ${binary}`);
  const binaryVersion = execFileSync(binary, ["--version"], {
    cwd: repoRoot,
    encoding: "utf8"
  }).trim();
  if (wrapperVersion !== null) {
    ok(
      binaryVersion === wrapperVersion,
      `Haxe wrapper selects ${wrapperVersion}, but ${binary} is ${binaryVersion}`
    );
  }
  return { binary, version: binaryVersion };
}

/** Reserves and releases one unused loopback port immediately before spawn. */
export async function unusedLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("Port reservation did not return a TCP address"));
        return;
      }
      probe.close((error) => error === undefined
        ? resolve(address.port)
        : reject(error));
    });
  });
}

function isStartupConnectionFailure(result: ProcessResult): boolean {
  return /^Fatal error: exception Failure\("Couldn't connect on [^"]+ \(Connection (?:refused|reset)\)"\)\s*$/m.test(
    `${result.stdout}\n${result.stderr}`
  );
}

/**
 * Owns one native Haxe compiler-server process for a bounded test sequence.
 *
 * Readiness is established by the first real compilation, never by opening and
 * abandoning a raw TCP connection. Only startup connection failures are
 * retried; a Haxe diagnostic fails immediately. Later requests never retry,
 * because a once-ready server becoming unavailable is a real lifecycle error.
 */
export class OwnedHaxeCompilerServer {
  public readonly port: number;
  public readonly process: ChildProcess;

  private serverLog = "";
  private ready = false;
  private stopped = false;
  private signalCleanup: SignalCleanup | null = null;

  private constructor(
    private readonly repoRoot: string,
    private readonly compiler: HaxeCompilerSelection,
    port: number
  ) {
    this.port = port;
    this.process = spawn(
      compiler.binary,
      ["--server-listen", `127.0.0.1:${port}`],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] }
    );
    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.serverLog = appendLog(this.serverLog, chunk);
    });
    this.process.stderr?.on("data", (chunk: Buffer) => {
      this.serverLog = appendLog(this.serverLog, chunk);
    });
    this.process.once("error", (error) => {
      this.serverLog = appendLog(
        this.serverLog,
        `\nserver error: ${String(error)}`
      );
    });
  }

  public static async start(
    repoRoot: string,
    compiler = selectedHaxeCompiler(repoRoot)
  ): Promise<OwnedHaxeCompilerServer> {
    return new OwnedHaxeCompilerServer(
      repoRoot,
      compiler,
      await unusedLoopbackPort()
    );
  }

  public get logs(): string {
    return this.serverLog;
  }

  public get version(): string {
    return this.compiler.version;
  }

  public installSignalCleanup(): void {
    ok(this.signalCleanup === null, "Signal cleanup is already installed");
    const handlers = new Map<NodeJS.Signals, () => void>();
    let handling = false;
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const handler = (): void => {
        if (handling) return;
        handling = true;
        void this.stop().finally(() => {
          for (const [ownedSignal, ownedHandler] of handlers) {
            process.off(ownedSignal, ownedHandler);
          }
          process.kill(process.pid, signal);
        });
      };
      handlers.set(signal, handler);
      process.on(signal, handler);
    }
    this.signalCleanup = {
      dispose: () => {
        for (const [signal, handler] of handlers) {
          process.off(signal, handler);
        }
      }
    };
  }

  /**
   * Sends one bounded compilation to this server.
   *
   * The optional working directory is the real client's project context, not a
   * generated-output convenience. Multi-project tests should also give Haxe
   * distinct compilation signatures when their module names overlap, because
   * Haxe 4's native typed-module cache is not isolated by classpath alone.
   */
  public async compile(
    args: ReadonlyArray<string>,
    label: string,
    timeoutMs: number,
    cwd = this.repoRoot
  ): Promise<ProcessResult> {
    ok(!this.stopped, `${label} attempted to use a stopped Haxe server`);
    const connectArgs = [
      "--connect",
      `127.0.0.1:${this.port}`,
      ...args
    ];
    const startupDeadline = Date.now() + 10_000;
    while (true) {
      const result = await runBoundedProcess(
        this.compiler.binary,
        connectArgs,
        {
          cwd,
          timeoutMs,
          label
        }
      );
      if (result.code === 0) {
        // The reserved port is necessarily released before Haxe can bind it.
        // A successful client is accepted only while our exact child remains
        // alive; otherwise another process could have won that narrow race.
        await new Promise((resolve) => setTimeout(resolve, 25));
        ok(
          this.process.exitCode === null && this.process.signalCode === null,
          `${label} connected successfully after the owned Haxe server exited`
          + `\nserver log:\n${this.serverLog}`
        );
        this.ready = true;
        return result;
      }
      if (
        !this.ready
        && this.process.exitCode === null
        && this.process.signalCode === null
        && Date.now() < startupDeadline
        && isStartupConnectionFailure(result)
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      return result;
    }
  }

  public async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.signalCleanup?.dispose();
    this.signalCleanup = null;
    await terminateOwnedChild(this.process, "Owned Haxe compiler server");
  }
}

/** Hashes a generated tree by sorted POSIX path and raw file bytes. */
export function hashTree(root: string): ReadonlyArray<TreeEntry> {
  const entries: TreeEntry[] = [];
  function visit(directory: string): void {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        entries.push({
          path: path.relative(root, absolute).split(path.sep).join("/"),
          sha256: createHash("sha256")
            .update(readFileSync(absolute))
            .digest("hex")
        });
      }
    }
  }
  visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

/** Returns private transaction stage directories still present below a root. */
export function leakedOutputStages(root: string): ReadonlyArray<string> {
  const stages: string[] = [];
  function visit(directory: string): void {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (!entry.isDirectory()) continue;
      if (/^\.genes-output-.*\.stage$/.test(entry.name)) {
        stages.push(path.relative(root, absolute).split(path.sep).join("/"));
      } else {
        visit(absolute);
      }
    }
  }
  visit(root);
  return stages.sort();
}

/**
 * Reconstructs the deterministic private output sentinel for one `-js` path.
 *
 * The sentinel lives outside the public tree so a failed custom generator does
 * not let Haxe delete the previous entrypoint. Tests may inspect only the path
 * derived from their own configured output; they must not glob another
 * compiler request's temporary files.
 */
export function compilerOutputSentinel(outputFile: string): string {
  const destination = path.resolve(outputFile).split(path.sep).join("/");
  const key = createHash("sha256").update(destination).digest("hex")
    .slice(0, 20);
  return path.join(tmpdir(), `genes-haxe-output-${key}.tmp`);
}
