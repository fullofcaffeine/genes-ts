import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  downstreamRepoRoot,
  loadDownstreamContracts,
  type DownstreamCommand,
  type DownstreamProfile
} from "./downstream-contracts.js";

interface Options {
  readonly execute: boolean;
  readonly allowHostNetwork: boolean;
  readonly ids: ReadonlySet<string>;
  readonly repoPaths: ReadonlyMap<string, string>;
  readonly outputPath?: string;
  readonly githubOutputId?: string;
}

interface CommandResult {
  readonly id: string;
  readonly class: DownstreamCommand["class"];
  readonly status: "passed" | "failed" | "skipped";
  readonly exitCode: number | null;
}

interface ProfileResult {
  readonly id: string;
  readonly repository: string;
  readonly revision: string;
  readonly status: "passed" | "failed";
  readonly commands: ReadonlyArray<CommandResult>;
}

function parseOptions(argv: ReadonlyArray<string>): Options {
  let execute = false;
  let allowHostNetwork = false;
  let outputPath: string | undefined;
  let githubOutputId: string | undefined;
  const ids = new Set<string>();
  const repoPaths = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--execute") {
      execute = true;
    } else if (argument === "--allow-host-network") {
      allowHostNetwork = true;
    } else if (argument === "--id") {
      const id = argv[++index];
      if (!id) throw new Error("--id requires a profile id");
      ids.add(id);
    } else if (argument === "--repo") {
      const mapping = argv[++index];
      if (!mapping) throw new Error("--repo requires id=path");
      const separator = mapping.indexOf("=");
      if (separator <= 0 || separator === mapping.length - 1) {
        throw new Error("--repo requires id=path");
      }
      repoPaths.set(mapping.slice(0, separator), mapping.slice(separator + 1));
    } else if (argument === "--output") {
      outputPath = argv[++index];
      if (!outputPath) throw new Error("--output requires a path");
    } else if (argument === "--emit-github-outputs") {
      githubOutputId = argv[++index];
      if (!githubOutputId) throw new Error("--emit-github-outputs requires a profile id");
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return { execute, allowHostNetwork, ids, repoPaths, outputPath, githubOutputId };
}

function git(cwd: string, args: ReadonlyArray<string>): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" }).trim();
}

function repositorySlug(remote: string): string | null {
  const normalized = remote.trim().replace(/\.git$/, "");
  const match = normalized.match(/(?:github\.com[/:])([^/]+\/[^/]+)$/);
  return match?.[1] ?? null;
}

function selectedProfiles(
  profiles: ReadonlyArray<DownstreamProfile>,
  ids: ReadonlySet<string>
): ReadonlyArray<DownstreamProfile> {
  if (ids.size === 0) return profiles;
  const selected = profiles.filter((profile) => ids.has(profile.id));
  const missing = [...ids].filter((id) => !profiles.some((profile) => profile.id === id));
  if (missing.length > 0) throw new Error(`Unknown downstream profile(s): ${missing.join(", ")}`);
  return selected;
}

function emitGitHubOutputs(profile: DownstreamProfile): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("GITHUB_OUTPUT is required for --emit-github-outputs");
  appendFileSync(
    outputPath,
    [
      `repository=${profile.repository}`,
      `revision=${profile.revision}`,
      `checkout=${profile.checkout}`,
      `branch=${profile.branch}`
    ].join("\n") + "\n"
  );
}

function verifyCheckout(profile: DownstreamProfile, checkoutPath: string): void {
  if (!existsSync(path.join(checkoutPath, ".git"))) {
    throw new Error(`${profile.id}: checkout is missing at the supplied workspace path`);
  }
  const revision = git(checkoutPath, ["rev-parse", "HEAD"]);
  if (revision !== profile.revision) {
    throw new Error(`${profile.id}: expected revision ${profile.revision}, found ${revision}`);
  }
  const slug = repositorySlug(git(checkoutPath, ["remote", "get-url", "origin"]));
  if (slug !== profile.repository) {
    throw new Error(`${profile.id}: origin is ${slug ?? "unrecognized"}, expected ${profile.repository}`);
  }
  const trackedStatus = git(checkoutPath, ["status", "--porcelain", "--untracked-files=no"]);
  if (trackedStatus.length > 0) {
    throw new Error(`${profile.id}: tracked checkout state must be clean before execution`);
  }
  const expectedCompiler = path.resolve(checkoutPath, "..", profile.compilerCheckout);
  if (expectedCompiler !== downstreamRepoRoot) {
    throw new Error(
      `${profile.id}: compiler must be a sibling checkout named ${profile.compilerCheckout}`
    );
  }
}

function isolatedEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/(TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION|CREDENTIAL)/i.test(key)) {
      delete environment[key];
    }
  }
  environment.CI = "1";
  environment.GENES_DOWNSTREAM_QA = "1";
  environment.GENES_NETWORK_POLICY = "deny";
  environment.HTTP_PROXY = "";
  environment.HTTPS_PROXY = "";
  environment.ALL_PROXY = "";
  environment.NO_PROXY = "127.0.0.1,localhost,::1";
  return environment;
}

function runProfile(profile: DownstreamProfile, checkoutPath: string): ProfileResult {
  verifyCheckout(profile, checkoutPath);
  const results: CommandResult[] = [];
  let failed = false;
  for (const command of profile.commands) {
    if (failed) {
      results.push({ id: command.id, class: command.class, status: "skipped", exitCode: null });
      continue;
    }
    process.stdout.write(
      `[downstream:${profile.id}] ${command.id}: ${command.executable} ${command.args.join(" ")}\n`
    );
    const result = spawnSync(command.executable, [...command.args], {
      cwd: checkoutPath,
      env: isolatedEnvironment(),
      stdio: "inherit"
    });
    const exitCode = result.status;
    if (result.error) throw result.error;
    if (exitCode !== 0) failed = true;
    results.push({
      id: command.id,
      class: command.class,
      status: exitCode === 0 ? "passed" : "failed",
      exitCode
    });
  }
  return {
    id: profile.id,
    repository: profile.repository,
    revision: profile.revision,
    status: failed ? "failed" : "passed",
    commands: results
  };
}

/**
 * Validates or executes pinned downstream pressure tests.
 *
 * Why: a WIP application can reveal compiler regressions, but an unpinned or
 * networked app run is neither reproducible nor safely attributable.
 *
 * What: validation is cheap and blocking in core CI. Execution is explicit,
 * revision-checked, and normally permitted only inside the nightly workflow's
 * OS network namespace. Results keep the compiler candidate, downstream run,
 * and deliberately unsupported application areas in separate JSON sections.
 *
 * How: commands execute without a shell, with credentials/proxies removed. A
 * failure remains `unclassified` until a generic genes fixture reproduces it.
 */
function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const contract = loadDownstreamContracts();
  if (options.githubOutputId) {
    const profile = contract.profiles.find((entry) => entry.id === options.githubOutputId);
    if (!profile) throw new Error(`Unknown downstream profile: ${options.githubOutputId}`);
    emitGitHubOutputs(profile);
  }

  const profiles = selectedProfiles(contract.profiles, options.ids);
  if (!options.execute) {
    if (options.outputPath) throw new Error("--output is only valid with --execute");
    console.log(`downstream-contracts:ok (${contract.profiles.length} pinned profiles; execution disabled)`);
    return;
  }
  if (process.env.GENES_NETWORK_ISOLATED !== "1" && !options.allowHostNetwork) {
    throw new Error(
      "Downstream execution requires GENES_NETWORK_ISOLATED=1 or explicit --allow-host-network"
    );
  }
  if (options.allowHostNetwork) {
    process.stderr.write(
      "warning: executing downstream contracts without OS network isolation (local maintainer override)\n"
    );
  }

  const results = profiles.map((profile) => {
    const configured = options.repoPaths.get(profile.id);
    const checkoutPath = configured
      ? path.resolve(configured)
      : path.resolve(downstreamRepoRoot, "..", profile.checkout);
    return runProfile(profile, checkoutPath);
  });
  const failed = results.some((result) => result.status === "failed");
  const compilerRevision = git(downstreamRepoRoot, ["rev-parse", "HEAD"]);
  const output = {
    schemaVersion: 1,
    contract: contract.contract,
    compiler: {
      revision: compilerRevision,
      observation: failed ? "downstream-failure-unclassified" : "passed-curated-integration"
    },
    downstream: results,
    knownObservations: profiles.flatMap((profile) =>
      profile.knownObservations.map((entry) => ({ profile: profile.id, ...entry }))
    ),
    unsupported: profiles.flatMap((profile) =>
      profile.unsupported.map((entry) => ({ profile: profile.id, ...entry }))
    )
  };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  if (options.outputPath) writeFileSync(path.resolve(options.outputPath), serialized);
  else process.stdout.write(serialized);
  if (failed) process.exitCode = 1;
}

main();
