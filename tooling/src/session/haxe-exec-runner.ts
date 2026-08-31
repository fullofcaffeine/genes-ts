import { readFileSync, writeSync } from "node:fs";
import path from "node:path";

const CONTROL_FD = 3;

class SafeRunnerError extends Error {}

function errorText(error: unknown): string {
  if (error instanceof SafeRunnerError) return error.message;
  if (
    error instanceof Error
    && "code" in error
    && typeof error.code === "string"
    && "syscall" in error
    && error.syscall === "execve"
  ) {
    return `execve failed with ${error.code}`;
  }
  return "Haxe raw-exec failed without a safe diagnostic";
}

function writeControl(message: string): void {
  try {
    writeSync(CONTROL_FD, message);
  } catch {
    // A direct diagnostic invocation can omit the private descriptor.
  }
}

function environmentFromStdin(): Record<string, string> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    throw new SafeRunnerError("Haxe launch environment must be valid JSON");
  }
  if (decoded === null || Array.isArray(decoded) || typeof decoded !== "object") {
    throw new SafeRunnerError("Haxe launch environment must be a JSON object");
  }
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(decoded)) {
    if (typeof value !== "string") {
      throw new SafeRunnerError(
        "Haxe launch environment values must be strings",
      );
    }
    if (key.includes("\0") || value.includes("\0")) {
      throw new SafeRunnerError(
        "Haxe launch environment must not contain NUL bytes",
      );
    }
    entries.push([key, value]);
  }
  // Object.fromEntries defines __proto__ as an ordinary own property. Direct
  // assignment to a plain object would invoke its legacy prototype setter and
  // silently omit that valid POSIX environment name.
  return Object.fromEntries(entries);
}

function recoverableExecve(): NonNullable<typeof process.execve> {
  const execve = process.execve;
  if (typeof execve !== "function") {
    throw new SafeRunnerError("This Node release does not provide process.execve");
  }
  try {
    // The helper starts with an empty process environment. Prove this exact
    // runtime returns from a failed system exec before target credentials are
    // read from stdin. /dev/null cannot become a program on supported POSIX
    // hosts; absence in a restricted root is also a normal execve failure.
    execve("/dev/null", ["/dev/null"], {});
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && typeof error.code === "string"
      && "syscall" in error
      && error.syscall === "execve"
    ) {
      return execve;
    }
    throw new SafeRunnerError(
      "Node raw exec did not return an errno-shaped failure",
    );
  }
  throw new SafeRunnerError(
    "Node raw exec failure probe unexpectedly replaced the helper",
  );
}

try {
  const [executable, ...args] = process.argv.slice(2);
  if (executable === undefined || !path.isAbsolute(executable)) {
    throw new SafeRunnerError("Haxe executable must be an absolute path");
  }
  const execve = recoverableExecve();
  const environment = environmentFromStdin();
  // READY means all launch input was validated and the raw exec call is next.
  // Node 26.1+ returns normal errno-shaped failures, so the outer boundary can
  // report a changed or removed target without aborting with this environment.
  writeControl("READY\n");
  execve(executable, [executable, ...args], environment);
} catch (error) {
  const detail = errorText(error);
  writeControl(`ERROR ${detail}\n`);
  try {
    writeSync(2, `Genes could not raw-exec Haxe: ${detail}\n`);
  } catch {
    // The control descriptor remains the authoritative launch failure.
  }
  process.exitCode = 126;
}
