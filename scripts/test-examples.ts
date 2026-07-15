import { deepStrictEqual, ok } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Owns the complete checked-in example matrix.
 *
 * Why: ad-hoc build scripts allowed an example or output profile to fall out of
 * acceptance without an obvious CI failure. This runner makes directory
 * inventory, source ownership, compiler profile, runtime smoke, and Playwright
 * ownership one deterministic contract.
 *
 * What/How: `examples/profiles.json` must enumerate every immediate example
 * directory and both first-class profiles. The minimal example runs a semantic
 * TS/classic differential; todoapp QA then exercises the same API and browser
 * suite once against TS-generated runtime and once against classic ESM.
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const examplesRoot = path.join(repoRoot, "examples");

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function run(script: string, args: ReadonlyArray<string> = []): void {
  execFileSync(process.execPath, [path.join(repoRoot, "scripts/dist", script), ...args], {
    cwd: repoRoot,
    stdio: "inherit"
  });
}

const manifest = record(
  JSON.parse(readFileSync(path.join(examplesRoot, "profiles.json"), "utf8")),
  "examples/profiles.json"
);
if (manifest.schemaVersion !== 1) {
  throw new Error("examples/profiles.json schemaVersion must be 1");
}
const declared = record(manifest.examples, "examples/profiles.json examples");
const actualDirectories = readdirSync(examplesRoot, {withFileTypes: true})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));
deepStrictEqual(Object.keys(declared).sort((a, b) => a.localeCompare(b)), actualDirectories);

for (const exampleName of actualDirectories) {
  const example = record(declared[exampleName], `example ${exampleName}`);
  const profiles = record(example.profiles, `${exampleName}.profiles`);
  deepStrictEqual(
    Object.keys(profiles).sort((a, b) => a.localeCompare(b)),
    ["classic-esm", "ts-strict"]
  );
  if (!Array.isArray(example.sourceRoots) || example.sourceRoots.length === 0) {
    throw new Error(`${exampleName}.sourceRoots must be a non-empty array`);
  }
  for (const sourceRoot of example.sourceRoots) {
    if (typeof sourceRoot !== "string" || !existsSync(path.join(repoRoot, sourceRoot))) {
      throw new Error(`${exampleName} has an invalid source root: ${String(sourceRoot)}`);
    }
  }
}

const args = new Set(process.argv.slice(2));
const withPlaywright = args.has("--playwright");
const skipTodoapp = args.has("--skip-todoapp");

run("build-example-typescript-target.js");

if (!skipTodoapp) {
  const playwrightArgs = withPlaywright ? ["--playwright"] : [];
  run("qa-todoapp.js", ["--profile", "ts", ...playwrightArgs]);
  run("qa-todoapp.js", [
    "--profile",
    "classic",
    ...playwrightArgs,
    ...(withPlaywright ? ["--skip-playwright-install"] : [])
  ]);
}

ok(true);
console.log(
  `examples:ok (${actualDirectories.length} examples, ts-strict + classic-esm)`
);
