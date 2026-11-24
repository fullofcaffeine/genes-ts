import { ok } from "node:assert";
import { execFile } from "node:child_process";

/**
 * Bounds independent HXX failure fixtures without changing gate deadlines.
 * Each caller owns a distinct output directory and performs the original
 * assertions. Stop admission on failure, then await both active observations
 * before allowing cleanup. The acceptance process owner retains timeout and
 * descendant cleanup; these children remain in its process group.
 */
export async function runHxxNegativeBatch<T>(
  cases: ReadonlyArray<T>,
  observe: (value: T) => Promise<void>,
  workers = process.env.GENES_HXX_NEGATIVE_WORKERS ?? "2"
): Promise<void> {
  ok(workers === "1" || workers === "2",
    "GENES_HXX_NEGATIVE_WORKERS must be 1 or 2");
  let next = 0;
  let failed = false;
  const failures: unknown[] = [];
  async function worker(): Promise<void> {
    while (!failed && next < cases.length) {
      const value = cases[next++];
      try {
        await observe(value);
      } catch (error: unknown) {
        failed = true;
        failures.push(error);
      }
    }
  }
  await Promise.all(Array.from({ length: Number(workers) }, worker));
  if (failed) throw new AggregateError(failures, "HXX negative batch failed");
}

/** Keep expected compiler rejection distinct from spawn, signal or pipe failure. */
export function compileHxxNegative(
  cwd: string,
  args: ReadonlyArray<string>
): Promise<{ readonly status: number; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("haxe", [...args], { cwd, encoding: "utf8", maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const status = error === null ? 0 : error.code;
        if (typeof status !== "number" || error?.signal != null) {
          reject(error);
          return;
        }
        resolve({ status, stdout, stderr });
      });
  });
}
