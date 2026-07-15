import { deepStrictEqual } from "node:assert";
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
 * What: `examples/profiles.json` must enumerate every immediate example
 * directory and both first-class profiles. Each profile owns structured build,
 * runtime, and optional browser commands; profile-specific source roots are not
 * representable, so TS and classic necessarily compile the same authored tree.
 *
 * How: the runner validates the complete manifest before executing anything,
 * invokes commands directly without a shell, deduplicates identical builders,
 * and selects either runtime smoke or browser QA for every profile. Adding an
 * example can no longer satisfy inventory checks without also running it.
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const examplesRoot = path.join(repoRoot, "examples");

type JsonRecord = Record<string, unknown>;

const PROFILE_NAMES = ["ts-strict", "classic-esm"] as const;
type ProfileName = (typeof PROFILE_NAMES)[number];

type CommandSpec = {
  command: string;
  args: ReadonlyArray<string>;
};

type ProfileSpec = {
  build: CommandSpec;
  runtime: CommandSpec;
  playwright: CommandSpec | null;
};

type ExampleSpec = {
  name: string;
  sourceRoots: ReadonlyArray<string>;
  profiles: Readonly<Record<ProfileName, ProfileSpec>>;
};

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function assertOnlyKeys(value: JsonRecord, allowed: ReadonlyArray<string>, label: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} has unsupported field(s): ${unexpected.join(", ")}`);
  }
}

function commandSpec(value: unknown, label: string): CommandSpec {
  const parsed = record(value, label);
  assertOnlyKeys(parsed, ["command", "args"], label);
  if (typeof parsed.command !== "string" || parsed.command.length === 0) {
    throw new Error(`${label}.command must be a non-empty string`);
  }
  if (!Array.isArray(parsed.args) || !parsed.args.every((arg) => typeof arg === "string")) {
    throw new Error(`${label}.args must be an array of strings`);
  }
  return { command: parsed.command, args: parsed.args };
}

function profileSpec(value: unknown, label: string): ProfileSpec {
  const parsed = record(value, label);
  assertOnlyKeys(parsed, ["build", "runtime", "playwright"], label);
  if (!("build" in parsed) || !("runtime" in parsed)) {
    throw new Error(`${label} must declare build and runtime commands`);
  }
  return {
    build: commandSpec(parsed.build, `${label}.build`),
    runtime: commandSpec(parsed.runtime, `${label}.runtime`),
    playwright: "playwright" in parsed
      ? commandSpec(parsed.playwright, `${label}.playwright`)
      : null
  };
}

function exampleSpec(name: string, value: unknown): ExampleSpec {
  const parsed = record(value, `example ${name}`);
  assertOnlyKeys(parsed, ["sourceRoots", "profiles"], `example ${name}`);
  if (!Array.isArray(parsed.sourceRoots) || parsed.sourceRoots.length === 0
    || !parsed.sourceRoots.every((root) => typeof root === "string")) {
    throw new Error(`${name}.sourceRoots must be a non-empty array of strings`);
  }
  for (const sourceRoot of parsed.sourceRoots) {
    if (!existsSync(path.join(repoRoot, sourceRoot))) {
      throw new Error(`${name} has an invalid source root: ${sourceRoot}`);
    }
  }

  const profiles = record(parsed.profiles, `${name}.profiles`);
  deepStrictEqual(
    Object.keys(profiles).sort((a, b) => a.localeCompare(b)),
    [...PROFILE_NAMES].sort((a, b) => a.localeCompare(b))
  );
  const parsedProfiles: Record<ProfileName, ProfileSpec> = {
    "ts-strict": profileSpec(profiles["ts-strict"], `${name}.profiles.ts-strict`),
    "classic-esm": profileSpec(profiles["classic-esm"], `${name}.profiles.classic-esm`)
  };
  const browserOwners = PROFILE_NAMES.filter((profile) => parsedProfiles[profile].playwright !== null);
  if (browserOwners.length !== 0 && browserOwners.length !== PROFILE_NAMES.length) {
    throw new Error(`${name} must declare Playwright QA for both profiles or neither profile`);
  }

  return { name, sourceRoots: parsed.sourceRoots, profiles: parsedProfiles };
}

function formatCommand(spec: CommandSpec): string {
  return [spec.command, ...spec.args.map((arg) => JSON.stringify(arg))].join(" ");
}

function run(spec: CommandSpec, label: string): void {
  console.log(`examples:${label}: ${formatCommand(spec)}`);
  execFileSync(spec.command, [...spec.args], {
    cwd: repoRoot,
    stdio: "inherit"
  });
}

const manifest = record(
  JSON.parse(readFileSync(path.join(examplesRoot, "profiles.json"), "utf8")),
  "examples/profiles.json"
);
assertOnlyKeys(manifest, ["schemaVersion", "examples"], "examples/profiles.json");
if (manifest.schemaVersion !== 2) {
  throw new Error("examples/profiles.json schemaVersion must be 2");
}
const declared = record(manifest.examples, "examples/profiles.json examples");
const actualDirectories = readdirSync(examplesRoot, {withFileTypes: true})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));
deepStrictEqual(Object.keys(declared).sort((a, b) => a.localeCompare(b)), actualDirectories);
const examples = actualDirectories.map((name) => exampleSpec(name, declared[name]));

const args = new Set(process.argv.slice(2));
const withPlaywright = args.has("--playwright");
const skipTodoapp = args.has("--skip-todoapp");
const executedBuilds = new Set<string>();
let executedExamples = 0;
let executedProfiles = 0;

for (const example of examples) {
  if (skipTodoapp && example.name === "todoapp") continue;
  executedExamples++;

  for (const profileName of PROFILE_NAMES) {
    const build = example.profiles[profileName].build;
    const buildKey = JSON.stringify([build.command, build.args]);
    if (!executedBuilds.has(buildKey)) {
      run(build, `${example.name}:${profileName}:build`);
      executedBuilds.add(buildKey);
    }
  }

  for (const profileName of PROFILE_NAMES) {
    const profile = example.profiles[profileName];
    const qa = withPlaywright && profile.playwright !== null
      ? profile.playwright
      : profile.runtime;
    run(qa, `${example.name}:${profileName}:${withPlaywright && profile.playwright !== null ? "playwright" : "runtime"}`);
    executedProfiles++;
  }
}

console.log(
  `examples:ok (${executedExamples} examples, ${executedProfiles} profile contracts)`
);
