import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Runs the repository's manifest-defined TypeScript API bridge compiler.
 *
 * ts2hx parses with the TS6 Program API, so its original-TS and generated-TS
 * smoke checks must use that same bridge rather than whichever `tsc` happens
 * to own a top-level binary. TS7 output compatibility is exercised by the
 * genes generated-output matrix and intentionally does not parse ts2hx input.
 */
export function runTypeScriptApiBridge(
  repoRoot: string,
  args: ReadonlyArray<string>,
  cwd: string = repoRoot
): void {
  execFileSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "run-typescript.mjs"), "apiBridge", ...args],
    { cwd, stdio: "inherit" }
  );
}
