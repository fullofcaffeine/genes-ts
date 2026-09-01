import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnSyncReturns,
} from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
} from "node:fs";
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
const MAX_FAT_MACH_O_SLICES = 64;
const CONTROL_DIRECTORY_PREFIX = "genes-haxe-exec-";
const CONTROL_SOCKET_NAME = "control.sock";
// Darwin permits 104 sockaddr_un bytes and Linux permits 108. Keep room for
// the terminating byte and for other POSIX implementations with that floor.
const CONTROL_PATH_BYTE_LIMIT = 100;

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

function assertStructuredInput(
  executable: string,
  args: readonly string[],
  cwd: string,
): void {
  if (executable.includes("\0")) {
    throw new HaxeLaunchError(
      "Haxe executable must not contain NUL bytes",
    );
  }
  if (cwd.includes("\0")) {
    throw new HaxeLaunchError(
      "Haxe working directory must not contain NUL bytes",
    );
  }
  if (args.some((argument) => argument.includes("\0"))) {
    throw new HaxeLaunchError("Haxe argument must not contain NUL bytes");
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

export type NativeExecutableInspection =
  | "native"
  | "not-native"
  | "unavailable";

function readExecutableRange(
  descriptor: number,
  fileSize: number,
  position: number,
  length: number,
): Buffer | undefined {
  if (
    !Number.isSafeInteger(position) ||
    position < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    position > fileSize - length
  ) {
    return undefined;
  }
  const bytes = Buffer.alloc(length);
  return readSync(descriptor, bytes, 0, length, position) === length
    ? bytes
    : undefined;
}

function uint64(
  bytes: Buffer,
  offset: number,
  littleEndian: boolean,
): number | undefined {
  const value = littleEndian
    ? bytes.readBigUInt64LE(offset)
    : bytes.readBigUInt64BE(offset);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}

function isElfExecutable(descriptor: number, fileSize: number): boolean {
  const header = readExecutableRange(descriptor, fileSize, 0, 20);
  if (
    header === undefined ||
    !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
    (header[4] !== 1 && header[4] !== 2) ||
    (header[5] !== 1 && header[5] !== 2) ||
    header[6] !== 1
  ) {
    return false;
  }
  const type = header[5] === 1
    ? header.readUInt16LE(16)
    : header.readUInt16BE(16);
  return type === 2 || type === 3;
}

function thinMachOEndian(header: Buffer): "little" | "big" | undefined {
  switch (header.subarray(0, 4).toString("hex")) {
    case "feedface":
    case "feedfacf":
      return "big";
    case "cefaedfe":
    case "cffaedfe":
      return "little";
    default:
      return undefined;
  }
}

function isThinMachOExecutable(
  descriptor: number,
  fileSize: number,
  position: number,
): boolean {
  const header = readExecutableRange(descriptor, fileSize, position, 16);
  if (header === undefined) return false;
  const endian = thinMachOEndian(header);
  if (endian === undefined) return false;
  const fileType = endian === "little"
    ? header.readUInt32LE(12)
    : header.readUInt32BE(12);
  return fileType === 2;
}

function isMachOExecutable(descriptor: number, fileSize: number): boolean {
  if (isThinMachOExecutable(descriptor, fileSize, 0)) return true;
  const header = readExecutableRange(descriptor, fileSize, 0, 8);
  if (header === undefined) return false;
  const magic = header.subarray(0, 4).toString("hex");
  const littleEndian = magic === "bebafeca" || magic === "bfbafeca";
  const sixtyFourBit = magic === "cafebabf" || magic === "bfbafeca";
  if (
    magic !== "cafebabe" &&
    magic !== "bebafeca" &&
    magic !== "cafebabf" &&
    magic !== "bfbafeca"
  ) {
    return false;
  }
  const sliceCount = littleEndian
    ? header.readUInt32LE(4)
    : header.readUInt32BE(4);
  if (sliceCount === 0 || sliceCount > MAX_FAT_MACH_O_SLICES) return false;
  const entryBytes = sixtyFourBit ? 32 : 20;
  const entries = readExecutableRange(
    descriptor,
    fileSize,
    8,
    sliceCount * entryBytes,
  );
  if (entries === undefined) return false;
  for (let index = 0; index < sliceCount; index += 1) {
    const entry = index * entryBytes;
    const position = sixtyFourBit
      ? uint64(entries, entry + 8, littleEndian)
      : littleEndian
        ? entries.readUInt32LE(entry + 8)
        : entries.readUInt32BE(entry + 8);
    const size = sixtyFourBit
      ? uint64(entries, entry + 16, littleEndian)
      : littleEndian
        ? entries.readUInt32LE(entry + 12)
        : entries.readUInt32BE(entry + 12);
    if (
      position !== undefined &&
      size !== undefined &&
      size >= 16 &&
      position <= fileSize - size &&
      isThinMachOExecutable(descriptor, fileSize, position)
    ) {
      return true;
    }
  }
  return false;
}

function isPeExecutable(
  descriptor: number,
  fileSize: number,
  executable: string,
): boolean {
  if (!executable.toLowerCase().endsWith(".exe")) return false;
  const dos = readExecutableRange(descriptor, fileSize, 0, 64);
  if (dos === undefined || dos.subarray(0, 2).toString("ascii") !== "MZ") {
    return false;
  }
  const peOffset = dos.readUInt32LE(0x3c);
  const header = readExecutableRange(descriptor, fileSize, peOffset, 26);
  if (
    header === undefined ||
    header.subarray(0, 4).toString("binary") !== "PE\0\0" ||
    header.readUInt16LE(20) < 2 ||
    (header.readUInt16LE(22) & 0x0002) === 0
  ) {
    return false;
  }
  const optionalMagic = header.readUInt16LE(24);
  return optionalMagic === 0x010b || optionalMagic === 0x020b;
}

export function inspectNativeExecutable(
  executable: string,
  platform: NodeJS.Platform,
): NativeExecutableInspection {
  if (platform !== "linux" && platform !== "darwin" && platform !== "win32") {
    return "not-native";
  }
  let descriptor: number | undefined;
  try {
    // O_NONBLOCK prevents a replaced pathname such as a FIFO from freezing the
    // host event loop before fstat can reject it as a non-file.
    descriptor = openSync(
      executable,
      fsConstants.O_RDONLY | fsConstants.O_NONBLOCK,
    );
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) return "not-native";
    const valid = platform === "linux"
      ? isElfExecutable(descriptor, stats.size)
      : platform === "darwin"
        ? isMachOExecutable(descriptor, stats.size)
        : platform === "win32"
          ? isPeExecutable(descriptor, stats.size, executable)
          : false;
    return valid ? "native" : "not-native";
  } catch (error) {
    // Preserve the normal spawn/exec diagnostic when the path disappeared.
    // Every existing target that cannot be inspected fails closed: POSIX can
    // execute a mode-0111 file even when this process cannot read its header.
    const code = error instanceof Error && "code" in error
      ? error.code
      : undefined;
    return code === "ENOENT" || code === "ENOTDIR"
      ? "unavailable"
      : "not-native";
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/**
 * Classifies a bounded current-platform executable header.
 *
 * This is process-shape evidence, not binary attestation. The trusted
 * toolchain owner must not race pathname or file-content mutation with a
 * launch.
 */
export function inspectNativeExecutableFile(
  executable: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return inspectNativeExecutable(executable, platform) === "native";
}

function assertNativeExecutableIfPresent(executable: string): void {
  if (inspectNativeExecutable(executable, process.platform) === "not-native") {
    throw new HaxeLaunchError(
      "Haxe executable must be a native current-platform image",
    );
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
  /** Releases a control channel that has not transferred to a child. */
  readonly dispose: () => void;
  readonly handoff: (child: ChildProcess) => Promise<void>;
}

function createControlPath(): {
  readonly directory: string;
  readonly controlPath: string;
} {
  const configuredBase = os.tmpdir();
  const bases = [
    ...(path.isAbsolute(configuredBase) ? [configuredBase] : []),
    "/tmp",
  ];
  for (const base of bases) {
    let directory: string;
    try {
      // POSIX mkdtemp creates the private directory with mode 0700.
      directory = mkdtempSync(path.join(base, CONTROL_DIRECTORY_PREFIX));
    } catch {
      continue;
    }
    const controlPath = path.join(directory, CONTROL_SOCKET_NAME);
    if (Buffer.byteLength(controlPath) <= CONTROL_PATH_BYTE_LIMIT) {
      return Object.freeze({ directory, controlPath });
    }
    rmSync(directory, { force: true, recursive: true });
  }
  throw new HaxeLaunchError(
    "Haxe raw-exec control path exceeds the POSIX byte limit",
  );
}

/** Creates one private control channel for a POSIX raw-exec launch. */
export function createRawExecControl(): RawExecControl {
  const { directory, controlPath } = createControlPath();
  const server = net.createServer();
  server.maxConnections = 1;
  let bound = false;
  let disposed = false;
  const removeDirectory = (): void => {
    try {
      rmSync(directory, { force: true, recursive: true });
    } catch {
      // A launch error remains authoritative if temporary cleanup fails.
    }
  };
  const closeDisposedServer = (): void => {
    try {
      server.close();
    } catch {
      // A pending listen is closed by the listening handler below.
    }
  };
  const dispose = (): void => {
    if (bound || disposed) return;
    disposed = true;
    // A pending Unix-socket listen can report its error on a later turn.
    server.once("error", () => {});
    closeDisposedServer();
    removeDirectory();
  };
  server.once("listening", () => {
    if (disposed) closeDisposedServer();
  });
  try {
    server.listen(controlPath);
  } catch (error) {
    dispose();
    const message = error instanceof Error ? error.message : String(error);
    throw new HaxeLaunchError(message);
  }
  return Object.freeze({
    path: controlPath,
    dispose,
    handoff(child: ChildProcess): Promise<void> {
      if (bound || disposed) {
        child.kill();
        return Promise.reject(
          new HaxeLaunchError("Haxe raw-exec control is no longer available"),
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
 * recoverable before it receives the Haxe environment. A bounded native-image
 * check runs immediately before every spawn. The child then replaces itself
 * through `execve`, so the returned PID becomes Haxe and an `ENOEXEC` target is
 * never interpreted as a script. Child exit or server readiness remains the
 * final success evidence. Windows creates the canonical native `.exe`
 * directly.
 */
export function launchHaxe(
  executable: string,
  args: readonly string[],
  options: HaxeLaunchOptions,
): HaxeLaunch {
  assertStructuredInput(executable, args, options.cwd);
  assertExecutable(executable);
  const environment = environmentBytes(options.environment);
  if (process.platform === "win32") {
    assertNativeExecutableIfPresent(executable);
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
  let child: ChildProcess;
  try {
    assertNativeExecutableIfPresent(executable);
    child = spawn(
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
  } catch (error) {
    control.dispose();
    const message = error instanceof Error ? error.message : String(error);
    throw new HaxeLaunchError(message);
  }
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
  assertStructuredInput(executable, args, options.cwd);
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
    assertNativeExecutableIfPresent(executable);
    return spawnSync(executable, [...args], {
      ...common,
      env: options.environment,
    });
  }
  assertNativeExecutableIfPresent(executable);
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
