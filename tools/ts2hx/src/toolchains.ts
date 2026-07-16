import { execFileSync } from "node:child_process";
import path from "node:path";

const generatedOutputLanes = ["legacyFloor", "apiBridge", "current"] as const;

/**
 * Runs the repository's manifest-defined TypeScript API bridge compiler.
 *
 * ts2hx parses with the TS6 Program API, so its original-TS and generated-TS
 * smoke checks must use that same bridge rather than whichever `tsc` happens
 * to own a top-level binary. TS7 intentionally does not parse ts2hx input;
 * generated Haxe-to-TypeScript output can still be checked separately below.
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

/**
 * Type-checks generated TypeScript without changing the ts2hx parser engine.
 *
 * Why: ts2hx intentionally owns one pinned TypeScript Program API, while its
 * generated user modules promise compatibility with the repository's TS5,
 * TS6, and TS7 output lanes. Conflating those contracts would make a parser
 * upgrade implicit.
 *
 * What: each manifest-defined lane receives the same no-emit tsconfig. How:
 * the root launcher resolves the exact package/version for the named lane;
 * this helper never imports or executes a second compiler API inside ts2hx.
 */
export function runTypeScriptGeneratedOutputLanes(
  repoRoot: string,
  args: ReadonlyArray<string>,
  cwd: string = repoRoot
): void {
  for (const lane of generatedOutputLanes) {
    execFileSync(
      process.execPath,
      [path.join(repoRoot, "scripts", "run-typescript.mjs"), lane, ...args],
      { cwd, stdio: "inherit" }
    );
  }
}
