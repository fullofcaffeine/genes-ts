import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

/** Runs repro consumers on the repository's manifest-defined TS floor. */
export function runLegacyTypeScript(args) {
  runTypeScript("legacyFloor", args);
}

/** Runs one repro consumer on all manifest-owned TypeScript compatibility lanes. */
export function runTypeScriptMatrix(args) {
  for (const lane of ["legacyFloor", "apiBridge", "current"]) {
    runTypeScript(lane, args);
  }
}

function runTypeScript(lane, args) {
  execFileSync(
    process.execPath,
    [path.join(repoRoot, "scripts/run-typescript.mjs"), lane, ...args],
    { cwd: repoRoot, stdio: "inherit" }
  );
}
