import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export type DownstreamCommandClass =
  | "prepare"
  | "compile"
  | "typecheck"
  | "typing-policy"
  | "module-policy"
  | "runtime-smoke";

export interface DownstreamCommand {
  readonly id: string;
  readonly class: DownstreamCommandClass;
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly expectedFailure?: DownstreamExpectedFailure;
}

/**
 * Describes one fail-closed exception in a pinned downstream profile.
 *
 * Why: a WIP application may own a known type error, but treating every
 * nonzero exit as equivalent either hides new regressions or makes the nightly
 * contract permanently red. A prose observation alone cannot distinguish the
 * pinned defect from a different failure.
 *
 * What: the command must exit with the exact code and emit exactly these
 * TypeScript diagnostic headline lines. Incidental npm banners and indented
 * diagnostic detail are deliberately ignored; added, removed, or changed
 * TypeScript errors are not.
 *
 * How: the executor captures output while replaying it to the terminal, extracts
 * TypeScript error headlines, and compares the ordered array byte-for-byte.
 * The referenced observation must be downstream-owned so compiler defects can
 * never be converted into an accepted baseline exception.
 */
export interface DownstreamExpectedFailure {
  readonly observation: string;
  readonly exitCode: number;
  readonly matcher: "typescript-diagnostics";
  readonly diagnostics: ReadonlyArray<string>;
}

export interface DownstreamExclusion {
  readonly id: string;
  readonly status: "not-claimed" | "not-yet-curated" | "excluded-from-curated";
  readonly reason: string;
}

export interface DownstreamObservation {
  readonly id: string;
  readonly owner: "compiler" | "downstream" | "unclassified";
  readonly status: "open";
  readonly tracking: string;
  readonly summary: string;
}

export interface DownstreamProfile {
  readonly id: string;
  readonly label: string;
  readonly repository: string;
  readonly remote: string;
  readonly branch: string;
  readonly revision: string;
  readonly checkout: string;
  readonly compilerCheckout: "genes";
  readonly maturity: "wip";
  readonly disposition: "nonblocking-nightly";
  readonly baseline: "passing" | "known-failure";
  readonly commands: ReadonlyArray<DownstreamCommand>;
  readonly knownObservations: ReadonlyArray<DownstreamObservation>;
  readonly unsupported: ReadonlyArray<DownstreamExclusion>;
}

export interface DownstreamContracts {
  readonly schemaVersion: 1;
  readonly contract: "genes-ts-curated-downstream-v1";
  readonly policy: {
    readonly ciDisposition: "nonblocking-nightly";
    readonly network: string;
    readonly failureOwnership: string;
    readonly fullApplications: string;
  };
  readonly profiles: ReadonlyArray<DownstreamProfile>;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const downstreamRepoRoot = path.resolve(scriptDir, "../..");
export const downstreamManifestPath = path.join(
  downstreamRepoRoot,
  "tests",
  "compatibility",
  "downstream-contracts.json"
);

const commandClasses = new Set<DownstreamCommandClass>([
  "prepare",
  "compile",
  "typecheck",
  "typing-policy",
  "module-policy",
  "runtime-smoke"
]);
const exclusionStatuses = new Set<DownstreamExclusion["status"]>([
  "not-claimed",
  "not-yet-curated",
  "excluded-from-curated"
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, label: string): ReadonlyArray<string> {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, index) => nonEmptyString(entry, `${label}[${index}]`));
}

function safeWorkspaceName(value: unknown, label: string): string {
  const name = nonEmptyString(value, label);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(`${label} must be a safe workspace directory name`);
  }
  return name;
}

function fullRevision(value: unknown, label: string): string {
  const revision = nonEmptyString(value, label);
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error(`${label} must be a full lowercase Git revision`);
  }
  return revision;
}

function parseCommand(value: unknown, label: string): DownstreamCommand {
  const input = record(value, label);
  const id = nonEmptyString(input.id, `${label}.id`);
  const className = nonEmptyString(input.class, `${label}.class`);
  if (!commandClasses.has(className as DownstreamCommandClass)) {
    throw new Error(`${label}.class is unsupported: ${className}`);
  }
  const executable = nonEmptyString(input.executable, `${label}.executable`);
  const args = stringArray(input.args, `${label}.args`);

  // Why: dependency bootstrap is allowed before the network namespace closes,
  // but the curated compiler contract itself must never install or fetch. Keep
  // this lexical guard deliberately small and pair it with OS isolation in CI.
  const commandText = [executable, ...args].join(" ").toLowerCase();
  for (const forbidden of ["npm install", "npm ci", "lix download", "curl ", "wget ", "git clone", "npx "]) {
    if (commandText.includes(forbidden)) {
      throw new Error(`${label} violates the no-network command policy: ${forbidden.trim()}`);
    }
  }

  const expectedFailure =
    input.expectedFailure === undefined
      ? undefined
      : parseExpectedFailure(input.expectedFailure, `${label}.expectedFailure`);

  return {
    id,
    class: className as DownstreamCommandClass,
    executable,
    args,
    ...(expectedFailure ? { expectedFailure } : {})
  };
}

function parseExpectedFailure(value: unknown, label: string): DownstreamExpectedFailure {
  const input = record(value, label);
  if (input.matcher !== "typescript-diagnostics") {
    throw new Error(`${label}.matcher must be typescript-diagnostics`);
  }
  if (
    typeof input.exitCode !== "number" ||
    !Number.isInteger(input.exitCode) ||
    input.exitCode <= 0
  ) {
    throw new Error(`${label}.exitCode must be a positive integer`);
  }
  const diagnostics = stringArray(input.diagnostics, `${label}.diagnostics`);
  if (diagnostics.length === 0) {
    throw new Error(`${label}.diagnostics must not be empty`);
  }
  if (new Set(diagnostics).size !== diagnostics.length) {
    throw new Error(`${label}.diagnostics must not contain duplicates`);
  }
  for (const [index, diagnostic] of diagnostics.entries()) {
    if (!/^.+\(\d+,\d+\): error TS\d+: .+$/.test(diagnostic)) {
      throw new Error(
        `${label}.diagnostics[${index}] must be a complete TypeScript diagnostic headline`
      );
    }
  }
  return {
    observation: nonEmptyString(input.observation, `${label}.observation`),
    exitCode: Number(input.exitCode),
    matcher: "typescript-diagnostics",
    diagnostics
  };
}

function parseExclusion(value: unknown, label: string): DownstreamExclusion {
  const input = record(value, label);
  const status = nonEmptyString(input.status, `${label}.status`);
  if (!exclusionStatuses.has(status as DownstreamExclusion["status"])) {
    throw new Error(`${label}.status is unsupported: ${status}`);
  }
  return {
    id: nonEmptyString(input.id, `${label}.id`),
    status: status as DownstreamExclusion["status"],
    reason: nonEmptyString(input.reason, `${label}.reason`)
  };
}

function parseObservation(value: unknown, label: string): DownstreamObservation {
  const input = record(value, label);
  const owner = nonEmptyString(input.owner, `${label}.owner`);
  if (owner !== "compiler" && owner !== "downstream" && owner !== "unclassified") {
    throw new Error(`${label}.owner is unsupported: ${owner}`);
  }
  if (input.status !== "open") throw new Error(`${label}.status must be open`);
  return {
    id: nonEmptyString(input.id, `${label}.id`),
    owner,
    status: "open",
    tracking: nonEmptyString(input.tracking, `${label}.tracking`),
    summary: nonEmptyString(input.summary, `${label}.summary`)
  };
}

function uniqueIds(values: ReadonlyArray<{ readonly id: string }>, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) throw new Error(`${label} contains duplicate id ${value.id}`);
    seen.add(value.id);
  }
}

function parseProfile(value: unknown, index: number): DownstreamProfile {
  const label = `profiles[${index}]`;
  const input = record(value, label);
  const repository = nonEmptyString(input.repository, `${label}.repository`);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`${label}.repository must be an owner/repository slug`);
  }
  const remote = nonEmptyString(input.remote, `${label}.remote`);
  if (remote !== `https://github.com/${repository}.git`) {
    throw new Error(`${label}.remote must be the canonical HTTPS URL for ${repository}`);
  }
  if (input.compilerCheckout !== "genes") {
    throw new Error(`${label}.compilerCheckout must be genes`);
  }
  if (input.maturity !== "wip" || input.disposition !== "nonblocking-nightly") {
    throw new Error(`${label} must remain a nonblocking WIP downstream contract`);
  }
  if (!Array.isArray(input.commands) || input.commands.length === 0) {
    throw new Error(`${label}.commands must be a non-empty array`);
  }
  if (!Array.isArray(input.unsupported) || input.unsupported.length === 0) {
    throw new Error(`${label}.unsupported must explicitly bound unclaimed areas`);
  }
  if (!Array.isArray(input.knownObservations)) {
    throw new Error(`${label}.knownObservations must be an array`);
  }
  const commands = input.commands.map((entry, commandIndex) =>
    parseCommand(entry, `${label}.commands[${commandIndex}]`)
  );
  const unsupported = input.unsupported.map((entry, exclusionIndex) =>
    parseExclusion(entry, `${label}.unsupported[${exclusionIndex}]`)
  );
  const knownObservations = input.knownObservations.map((entry, observationIndex) =>
    parseObservation(entry, `${label}.knownObservations[${observationIndex}]`)
  );
  uniqueIds(commands, `${label}.commands`);
  uniqueIds(unsupported, `${label}.unsupported`);
  uniqueIds(knownObservations, `${label}.knownObservations`);

  const baseline = nonEmptyString(input.baseline, `${label}.baseline`);
  if (baseline !== "passing" && baseline !== "known-failure") {
    throw new Error(`${label}.baseline is unsupported: ${baseline}`);
  }
  if ((baseline === "passing") !== (knownObservations.length === 0)) {
    throw new Error(`${label}.baseline and knownObservations disagree`);
  }

  const observationById = new Map(knownObservations.map((entry) => [entry.id, entry]));
  const referencedObservations = new Set<string>();
  for (const command of commands) {
    const expected = command.expectedFailure;
    if (!expected) continue;
    if (command.class !== "typecheck") {
      throw new Error(
        `${label}.commands.${command.id}.expectedFailure currently supports only typecheck commands`
      );
    }
    const observation = observationById.get(expected.observation);
    if (!observation) {
      throw new Error(
        `${label}.commands.${command.id}.expectedFailure references unknown observation ${expected.observation}`
      );
    }
    if (observation.owner !== "downstream") {
      throw new Error(
        `${label}.commands.${command.id}.expectedFailure must reference a downstream-owned observation`
      );
    }
    if (referencedObservations.has(observation.id)) {
      throw new Error(`${label} references observation ${observation.id} more than once`);
    }
    referencedObservations.add(observation.id);
  }
  for (const observation of knownObservations) {
    if (!referencedObservations.has(observation.id)) {
      throw new Error(`${label}.knownObservations.${observation.id} has no expected failure command`);
    }
  }

  const commandClassesSeen = new Set(commands.map((command) => command.class));
  for (const required of ["compile", "typecheck", "runtime-smoke"] as const) {
    if (!commandClassesSeen.has(required)) {
      throw new Error(`${label} must own a ${required} command`);
    }
  }

  return {
    id: safeWorkspaceName(input.id, `${label}.id`),
    label: nonEmptyString(input.label, `${label}.label`),
    repository,
    remote,
    branch: nonEmptyString(input.branch, `${label}.branch`),
    revision: fullRevision(input.revision, `${label}.revision`),
    checkout: safeWorkspaceName(input.checkout, `${label}.checkout`),
    compilerCheckout: "genes",
    maturity: "wip",
    disposition: "nonblocking-nightly",
    baseline,
    commands,
    knownObservations,
    unsupported
  };
}

/**
 * Loads the immutable cross-repository QA contract.
 *
 * Why: moving WIP applications are useful compiler pressure tests, but running
 * whatever happens to be on their default branches creates irreproducible and
 * easily misclassified failures.
 *
 * What: every profile pins a full Git revision, owns compile/typecheck/smoke
 * commands, and lists the application areas the compiler repository does not
 * claim as evidence.
 *
 * How: validate the JSON before either report generation or execution. The
 * executor additionally verifies the checkout revision and OS-level network
 * isolation; this loader intentionally performs no filesystem or Git mutation.
 */
export function loadDownstreamContracts(): DownstreamContracts {
  const parsed: unknown = JSON.parse(readFileSync(downstreamManifestPath, "utf8"));
  const input = record(parsed, "downstream manifest");
  if (input.schemaVersion !== 1 || input.contract !== "genes-ts-curated-downstream-v1") {
    throw new Error("downstream manifest schema/contract is unsupported");
  }
  const policy = record(input.policy, "downstream manifest policy");
  if (policy.ciDisposition !== "nonblocking-nightly") {
    throw new Error("downstream policy must remain nonblocking-nightly");
  }
  if (!Array.isArray(input.profiles) || input.profiles.length === 0) {
    throw new Error("downstream manifest profiles must be a non-empty array");
  }
  const profiles = input.profiles.map(parseProfile);
  uniqueIds(profiles, "downstream profiles");
  const checkouts = profiles.map((profile) => ({ id: profile.checkout }));
  uniqueIds(checkouts, "downstream checkouts");

  return {
    schemaVersion: 1,
    contract: "genes-ts-curated-downstream-v1",
    policy: {
      ciDisposition: "nonblocking-nightly",
      network: nonEmptyString(policy.network, "policy.network"),
      failureOwnership: nonEmptyString(policy.failureOwnership, "policy.failureOwnership"),
      fullApplications: nonEmptyString(policy.fullApplications, "policy.fullApplications")
    },
    profiles
  };
}
