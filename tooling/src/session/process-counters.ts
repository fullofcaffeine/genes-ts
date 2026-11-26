import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Counters of one process at one moment, read from outside the process.
 *
 * `instructions` are the retired CPU instructions since the process
 * started. On a busy host they repeat within about 2% for the same work,
 * while wall time can vary by 160%. They are `null` when this platform
 * gives no route without root or a native add-on; `unavailable` then says
 * why. `cpuNs` is user plus system CPU time, or `null` when it cannot be
 * read either.
 */
export interface ProcessCounters {
  readonly pid: number;
  readonly instructions: number | null;
  readonly cpuNs: number | null;
  readonly unavailable: string | null;
}

/**
 * What one request cost a process: the difference of two
 * `ProcessCounters` of the same process, before and after the request.
 */
export interface ProcessCounterDelta {
  readonly instructions: number | null;
  readonly cpuMs: number | null;
  /** Why `instructions` is null, else null. */
  readonly unavailable: string | null;
}

/** `RUSAGE_INFO_V4` of `<sys/resource.h>`: the first flavor with `ri_instructions`. */
const RUSAGE_INFO_V4 = 4;
/** The size of `struct rusage_info_v4`, and the byte offsets of the fields read. */
const RUSAGE_INFO_V4_BYTES = 296;
const RI_USER_TIME = 16;
const RI_SYSTEM_TIME = 24;
const RI_INSTRUCTIONS = 248;
/** Linux clock ticks per second of `/proc/<pid>/stat` (`sysconf(_SC_CLK_TCK)`, 100 on Linux builds in use). */
const LINUX_CLOCK_TICKS = 100;
const HELPER = fileURLToPath(import.meta.url);
const HELPER_FLAGS = Object.freeze([
  "--experimental-ffi",
  "--disable-warning=ExperimentalWarning",
]);
const HELPER_TIMEOUT_MS = 10_000;
/** The largest pid that `proc_pid_rusage` takes (`int32`). */
const MAX_PID = 0x7fff_ffff;
/** The reason for a Node that has no `node:ffi`, such as Node 24. */
const NO_FFI = "this Node has no node:ffi (retired instructions need Node 26 or later)";

/** The two calls of `libSystem` that the macOS route needs. */
interface DarwinCalls {
  readonly procPidRusage: (pid: number, flavor: number, buffer: Buffer) => number;
  /** Nanoseconds per Mach time unit, from `mach_timebase_info`. */
  readonly nanosecondsPerTick: number;
}

/** The functions of `node:ffi` that this file uses. */
interface FfiModule {
  readonly dlopen: (
    path: string,
    definitions: Readonly<Record<string, { readonly parameters: readonly string[]; readonly result: string }>>,
  ) => { readonly functions: Readonly<Record<string, (...args: unknown[]) => unknown>> };
}

let darwinCalls: Promise<DarwinCalls | null> | null = null;

/**
 * Loads `proc_pid_rusage` and `mach_timebase_info` through `node:ffi` in
 * this process, or returns null when Node runs without
 * `--experimental-ffi`. No native build step is involved: `node:ffi` is
 * part of Node 26.
 *
 * BOUNDARY_DYNAMIC: `node:ffi` has no type declarations; the two functions
 * are checked to be functions and called with the declared argument types.
 */
async function loadDarwinCalls(): Promise<DarwinCalls | null> {
  const specifier = "node:ffi";
  let ffi: FfiModule;
  try {
    ffi = (await import(specifier)) as FfiModule;
  } catch {
    return null;
  }
  try {
    const { functions } = ffi.dlopen("/usr/lib/libSystem.B.dylib", {
      proc_pid_rusage: { parameters: ["int32", "int32", "buffer"], result: "int32" },
      mach_timebase_info: { parameters: ["buffer"], result: "int32" },
    });
    const rusage = functions.proc_pid_rusage;
    const timebase = functions.mach_timebase_info;
    if (typeof rusage !== "function" || typeof timebase !== "function") return null;
    const info = Buffer.alloc(8);
    if (timebase(info) !== 0) return null;
    const numer = info.readUInt32LE(0);
    const denom = info.readUInt32LE(4);
    if (numer === 0 || denom === 0) return null;
    return Object.freeze({
      procPidRusage: (pid: number, flavor: number, buffer: Buffer) =>
        Number(rusage(pid, flavor, buffer)),
      nanosecondsPerTick: numer / denom,
    });
  } catch {
    return null;
  }
}

/**
 * Reads the counters of `pid` with `proc_pid_rusage`, or returns null when
 * the call fails or throws (for example a pid that is no `int32`), so that
 * a read never fails a compile request.
 */
function readDarwin(calls: DarwinCalls, pid: number): ProcessCounters | null {
  const buffer = Buffer.alloc(RUSAGE_INFO_V4_BYTES);
  try {
    if (calls.procPidRusage(pid, RUSAGE_INFO_V4, buffer) !== 0) return null;
  } catch {
    return null;
  }
  const ticks =
    buffer.readBigUInt64LE(RI_USER_TIME) + buffer.readBigUInt64LE(RI_SYSTEM_TIME);
  return Object.freeze({
    pid,
    instructions: Number(buffer.readBigUInt64LE(RI_INSTRUCTIONS)),
    cpuNs: Math.round(Number(ticks) * calls.nanosecondsPerTick),
    unavailable: null,
  });
}

/**
 * Reads the counters of `pid` in a short helper process
 * (`node --experimental-ffi` on this file), for a host that runs Node
 * without that flag.
 *
 * BOUNDARY_DYNAMIC: the helper prints one JSON object; each field is
 * checked before use.
 */
function readDarwinInHelper(pid: number): Promise<ProcessCounters | null> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [...HELPER_FLAGS, HELPER, String(pid)],
      { env: {}, timeout: HELPER_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        // The helper prints `null` for a process that it may not read, as
        // the in-process route returns null for it.
        if (error === null && stdout.trim() === "null") {
          resolve(null);
          return;
        }
        const counters = error === null ? parseCounters(stdout, pid) : null;
        resolve(counters ?? unavailableCounters(pid, "macOS: the node:ffi helper process failed"));
      },
    );
  });
}

/** Counters of `pid` with neither counter, and the reason why. */
function unavailableCounters(pid: number, why: string): ProcessCounters {
  return Object.freeze({ pid, instructions: null, cpuNs: null, unavailable: why });
}

/** Returns the counters in `text` (the helper's JSON line), or null when it is not one. */
function parseCounters(text: string, pid: number): ProcessCounters | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const value = parsed as {
    readonly pid?: unknown;
    readonly instructions?: unknown;
    readonly cpuNs?: unknown;
    readonly unavailable?: unknown;
  };
  const counted = (field: unknown): field is number | null =>
    field === null || (typeof field === "number" && Number.isFinite(field) && field >= 0);
  if (
    value.pid !== pid ||
    !counted(value.instructions) ||
    !counted(value.cpuNs) ||
    !(value.unavailable === null || typeof value.unavailable === "string")
  ) {
    return null;
  }
  return Object.freeze({
    pid,
    instructions: value.instructions,
    cpuNs: value.cpuNs,
    unavailable: value.unavailable,
  });
}

/**
 * Reads the CPU time of `pid` from `/proc/<pid>/stat` (fields 14 and 15,
 * after the command name in parentheses), or returns null.
 */
function readLinux(pid: number): ProcessCounters | null {
  let text: string;
  try {
    text = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
  // `fields[0]` is field 3 (state), so field 14 is `fields[11]`.
  const user = Number(fields[11]);
  const system = Number(fields[12]);
  if (!Number.isFinite(user) || !Number.isFinite(system)) return null;
  return Object.freeze({
    pid,
    instructions: null,
    cpuNs: Math.round(((user + system) * 1e9) / LINUX_CLOCK_TICKS),
    unavailable:
      "Linux: retired instructions need perf_event_open, which Node cannot call without a native add-on",
  });
}

/**
 * Returns the counters of the process `pid` now, or null when this process
 * may not read them (another user's process, or a process that exited).
 *
 * Why: the session measures each Haxe request by the counters of the
 * compiler server before and after it (`processCounterDelta`). Retired
 * instructions repeat on a loaded host; wall time does not.
 *
 * How: on macOS, `proc_pid_rusage` with `RUSAGE_INFO_V4` (no root needed
 * for a process of the same user), through `node:ffi` in this process when
 * Node runs with `--experimental-ffi`, else in a short helper process that
 * does (50 to 140 ms more per read, measured at load 39 to 53). A Node
 * without `node:ffi` (Node 24) starts no helper: both counters are
 * unavailable, with that reason. On Linux only the CPU time, from `/proc`;
 * instructions are unavailable (see `unavailable`). On other platforms both
 * are unavailable. Never throws.
 */
export async function readProcessCounters(pid: number): Promise<ProcessCounters | null> {
  if (!Number.isInteger(pid) || pid <= 0 || pid > MAX_PID) return null;
  switch (process.platform) {
    case "darwin": {
      darwinCalls ??= loadDarwinCalls();
      const calls = await darwinCalls;
      if (calls !== null) return readDarwin(calls, pid);
      // `--experimental-ffi` is a Node option exactly when this Node has
      // `node:ffi`; without it a helper could not work either.
      if (!process.allowedNodeEnvironmentFlags.has("--experimental-ffi")) {
        return unavailableCounters(pid, NO_FFI);
      }
      return await readDarwinInHelper(pid);
    }
    case "linux":
      return readLinux(pid);
    default:
      return unavailableCounters(pid, `${process.platform}: no route to the counters of another process`);
  }
}

/**
 * Returns what happened between two reads of the same process: the
 * instructions it retired and the CPU time it used, in milliseconds. A
 * counter is null when either read lacks it.
 */
export function processCounterDelta(
  before: ProcessCounters,
  after: ProcessCounters,
): ProcessCounterDelta {
  const instructions =
    before.instructions === null || after.instructions === null
      ? null
      : after.instructions - before.instructions;
  const cpuMs =
    before.cpuNs === null || after.cpuNs === null
      ? null
      : Math.round((after.cpuNs - before.cpuNs) / 10_000) / 100;
  return Object.freeze({
    instructions,
    cpuMs,
    unavailable: instructions === null ? (after.unavailable ?? before.unavailable ?? "not read") : null,
  });
}

// The helper entry (`readDarwinInHelper`): `node --experimental-ffi
// process-counters.js <pid>` prints the counters of <pid> as one JSON line.
if (process.argv[1] === HELPER) {
  const pid = Number(process.argv[2]);
  void (async () => {
    darwinCalls = loadDarwinCalls();
    const calls = await darwinCalls;
    // `null` only for a process that it may not read (as the in-process
    // route); a failed load of `node:ffi` gives a reason instead.
    const counters = calls === null || process.platform !== "darwin"
      ? unavailableCounters(pid, "macOS: the node:ffi helper could not load proc_pid_rusage")
      : readDarwin(calls, pid);
    process.stdout.write(`${JSON.stringify(counters)}\n`);
  })();
}
