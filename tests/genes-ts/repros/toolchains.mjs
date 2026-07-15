import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

/** Runs repro consumers on the repository's manifest-defined TS floor. */
export function runLegacyTypeScript(args) {
  execFileSync(
    process.execPath,
    [path.join(repoRoot, "scripts/run-typescript.mjs"), "legacyFloor", ...args],
    { cwd: repoRoot, stdio: "inherit" }
  );
}
