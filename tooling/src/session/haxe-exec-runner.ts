import { readSync, writeSync } from "node:fs";
import net, { type Socket } from "node:net";
import path from "node:path";

import { HAXE_ENVIRONMENT_PAYLOAD_LIMIT } from "./haxe-exec-contract.js";

class SafeRunnerError extends Error {}

let failureStarted = false;

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

function finishFailure(error: unknown, control?: Socket): void {
  if (failureStarted) return;
  failureStarted = true;
  const detail = errorText(error);
  try {
    writeSync(2, `Genes could not raw-exec Haxe: ${detail}\n`);
  } catch {
    // The fixed control diagnostic remains available when stderr is closed.
  }
  if (control === undefined || control.destroyed) process.exit(126);

  const exit = (): void => process.exit(126);
  control.once("error", exit);
  control.end(`ERROR ${detail}\n`, exit);
  setTimeout(exit, 100).unref();
}

function environmentPayloadLength(value: string | undefined): number {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new SafeRunnerError(
      "Haxe launch environment byte length is invalid",
    );
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length > HAXE_ENVIRONMENT_PAYLOAD_LIMIT) {
    throw new SafeRunnerError(
      "Haxe launch environment exceeds its byte limit",
    );
  }
  return length;
}

function environmentPayloadFromStdin(length: number): string {
  const payload = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const bytesRead = readSync(0, payload, offset, length - offset, null);
    if (bytesRead === 0) {
      throw new SafeRunnerError(
        "Haxe launch environment ended before its declared byte length",
      );
    }
    offset += bytesRead;
  }
  return payload.toString("utf8");
}

function environmentFromStdin(length: number): Record<string, string> {
  const payload = environmentPayloadFromStdin(length);
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
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

function execute(
  execve: NonNullable<typeof process.execve>,
  executable: string,
  args: readonly string[],
  environment: Record<string, string>,
  control?: Socket,
): void {
  if (control === undefined) {
    try {
      execve(executable, [executable, ...args], environment);
    } catch (error) {
      finishFailure(error);
    }
    return;
  }
  control.write("READY\n", (error?: Error | null) => {
    if (error !== undefined && error !== null) {
      finishFailure(
        new SafeRunnerError("Haxe raw-exec control is unavailable"),
        control,
      );
      return;
    }
    try {
      execve(executable, [executable, ...args], environment);
    } catch (execError) {
      finishFailure(execError, control);
    }
  });
}

try {
  const [controlPath, payloadLengthText, executable, ...args] =
    process.argv.slice(2);
  const payloadLength = environmentPayloadLength(payloadLengthText);
  if (executable === undefined || !path.isAbsolute(executable)) {
    throw new SafeRunnerError("Haxe executable must be an absolute path");
  }
  const execve = recoverableExecve();
  if (controlPath === "-") {
    execute(execve, executable, args, environmentFromStdin(payloadLength));
  } else {
    if (controlPath === undefined || !path.isAbsolute(controlPath)) {
      throw new SafeRunnerError("Haxe raw-exec control path is invalid");
    }
    const control = net.createConnection(controlPath);
    control.once("error", () => {
      finishFailure(new SafeRunnerError("Haxe raw-exec control is unavailable"));
    });
    control.once("connect", () => {
      try {
        const environment = environmentFromStdin(payloadLength);
        // READY means all launch input was validated and execve is next. The
        // runner-created socket closes on successful replacement. A failed
        // exec remains in this process and appends a fixed ERROR record.
        execute(execve, executable, args, environment, control);
      } catch (error) {
        finishFailure(error, control);
      }
    });
  }
} catch (error) {
  finishFailure(error);
}
