import { readFileSync, writeSync } from "node:fs";
import path from "node:path";

const CONTROL_FD = 3;
const ERROR_LIMIT = 2_048;

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\r|\n/gu, " ").slice(0, ERROR_LIMIT);
}

function writeControl(message: string): void {
  try {
    writeSync(CONTROL_FD, message);
  } catch {
    // A direct diagnostic invocation can omit the private descriptor.
  }
}

function environmentFromStdin(): Record<string, string> {
  const decoded: unknown = JSON.parse(readFileSync(0, "utf8"));
  if (decoded === null || Array.isArray(decoded) || typeof decoded !== "object") {
    throw new Error("Haxe launch environment must be a JSON object");
  }
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(decoded)) {
    if (typeof value !== "string") {
      throw new Error("Haxe launch environment values must be strings");
    }
    environment[key] = value;
  }
  return environment;
}

try {
  const [executable, ...args] = process.argv.slice(2);
  if (executable === undefined || !path.isAbsolute(executable)) {
    throw new Error("Haxe executable must be an absolute path");
  }
  if (typeof process.execve !== "function") {
    throw new Error("This Node release does not provide process.execve");
  }
  const environment = environmentFromStdin();
  // READY means all launch input was validated and the raw exec call is next.
  // Reviewed Node 22/24 releases abort this process if the OS call fails, so
  // the parent also requires child completion or server readiness as evidence.
  writeControl("READY\n");
  process.execve(executable, [executable, ...args], environment);
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
