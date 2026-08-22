import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { performance } from "node:perf_hooks";

type SourceFamily = "harness" | "language" | "unitstd" | "issue";
type ProfileId = "classic-esm" | "typescript";
type RuntimeLane = "smoke" | "representative";

interface SourceRecord {
  family: SourceFamily;
  path: string;
  sha256: string;
}

interface ActiveTestRecord {
  id: string;
  family: Exclude<SourceFamily, "harness">;
  expectedAssertions?: number;
  caseId?: string;
  define?: string;
  source?: string;
  expectedProfiles?: Record<ProfileId, ExpectedProfileOutcome>;
}

type FailurePhase = "generation" | "target-check" | "runtime";

type ExpectedProfileOutcome = {
  status: "pass";
  assertions: number;
} | {
  status: "known-failure";
  phase: FailurePhase;
  diagnostic: string;
  owner: string;
};

interface FileIdentity {
  path: string;
  sha256: string;
}

interface PortableManifest {
  schemaVersion: number;
  sourceCacheSchema: number;
  contract: string;
  haxe: {
    repository: string;
    version: string;
    revision: string;
    license: string;
    licensePath: string;
  };
  utest: {
    repository: string;
    revision: string;
    license: string;
    licensePath: string;
  };
  runnerAdaptation: {
    disposition: "upstream-harness-adaptation";
    reason: string;
    upstream: FileIdentity[];
    local: FileIdentity[];
  };
  sources: SourceRecord[];
  activeTests: ActiveTestRecord[];
  expectedAssertionsPerProfile?: number;
  profiles: Array<{id: ProfileId}>;
  executionScopes?: {
    quick: {command: string; representativeIncluded: false};
    scheduled: {
      command: string;
      representativeIncluded: true;
      enrollmentOwner: string;
    };
    release: {
      command: string;
      representativeIncluded: true;
      enrollmentOwner: string;
    };
  };
  claim: string;
}

interface RuntimeResult {
  profile: ProfileId;
  activeTests: string[];
  tests: Array<{
    id: string;
    assertions: number;
    failures: number;
  }>;
  assertions: number;
  failures: number;
}

interface StageResult {
  id: string;
  durationMs: number;
  command: string;
  log: string;
}

interface ProfileReport {
  profile: ProfileId;
  status: "pass";
  result: RuntimeResult;
  stages: StageResult[];
  artifacts: string[];
}

interface KnownFailureReport {
  profile: ProfileId;
  status: "known-failure";
  phase: FailurePhase;
  diagnostic: string;
  owner: string;
  stages: StageResult[];
  artifacts: string[];
}

type CaseProfileReport = ProfileReport | KnownFailureReport;

interface SourceMaterialization {
  root: string;
  cacheHit: boolean;
  stages: StageResult[];
}

interface SourceMarker {
  schemaVersion: 1;
  repository: string;
  revision: string;
  treeHash: string;
}

interface OfficialInventory {
  profile: ProfileId;
  haxeRevision: string;
  utestRevision: string;
  activeTests: Array<{id: string; source: string}>;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const laneValue = process.env.GENES_PORTABLE_HAXE_LANE ?? "smoke";
assert(laneValue === "smoke" || laneValue === "representative",
  `Unknown GENES_PORTABLE_HAXE_LANE value: ${laneValue}`);
const lane: RuntimeLane = laneValue;
const laneConfig = lane === "smoke" ? {
  contract: "genes-official-haxe-smoke",
  fixture: "portable-haxe-smoke",
  main: "portable.PortableSmokeMain"
} : {
  contract: "genes-official-haxe-representative",
  fixture: "official-haxe-representative",
  main: "representative.RepresentativeMain"
};
const fixtureRoot = path.join(repoRoot, "tests", laneConfig.fixture);
const manifestPath = path.join(fixtureRoot, "manifest.json");
const publicEvidenceRoot = path.join(
  repoRoot,
  ".tmp",
  "test-evidence",
  laneConfig.fixture
);
let evidenceRoot = publicEvidenceRoot;
let dependencyRoot = path.join(evidenceRoot, "dependencies");
const sourceCacheRoot = path.join(repoRoot, ".cache", laneConfig.fixture);
const manifest = JSON.parse(
  readFileSync(manifestPath, "utf8")
) as PortableManifest;
const configuredTimeout = Number.parseInt(
  process.env.GENES_PORTABLE_SMOKE_STAGE_TIMEOUT_MS ?? "120000",
  10
);
assert(Number.isFinite(configuredTimeout) && configuredTimeout > 0,
  "GENES_PORTABLE_SMOKE_STAGE_TIMEOUT_MS must be a positive integer");
const stageTimeoutMs = configuredTimeout;
const runtimeTimeoutMs = Number.parseInt(
  process.env.GENES_PORTABLE_SMOKE_RUNTIME_TIMEOUT_MS
    ?? String(stageTimeoutMs),
  10
);
assert(Number.isFinite(runtimeTimeoutMs) && runtimeTimeoutMs > 0,
  "GENES_PORTABLE_SMOKE_RUNTIME_TIMEOUT_MS must be a positive integer");
const injection = process.env.GENES_PORTABLE_SMOKE_INJECT;
const injectionProfile = process.env.GENES_PORTABLE_SMOKE_INJECT_PROFILE
  ?? "classic-esm";
const validInjections = new Set([
  "generation",
  "javascript-syntax",
  "typescript-strict",
  "module-load",
  "assertion",
  "assertion-count",
  "cache-hash-drift",
  "runtime-exception",
  "timeout",
  "publication",
  "missing-active"
]);
assert(injection === undefined || validInjections.has(injection),
  `Unknown GENES_PORTABLE_SMOKE_INJECT value: ${String(injection)}`);
assert(injectionProfile === "classic-esm" || injectionProfile === "typescript",
  `Unknown GENES_PORTABLE_SMOKE_INJECT_PROFILE: ${injectionProfile}`);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class StageExecutionError extends Error {
  constructor(
    readonly stage: StageResult,
    readonly stageLog: string,
    message: string
  ) {
    super(message);
  }
}

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceTreeHash(root: string): string {
  const hash = createHash("sha256");
  function visit(current: string): void {
    const entries = readdirSync(current, {withFileTypes: true})
      .sort((left, right) => compareStrings(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      if (relative === ".genes-source.json") continue;
      if (entry.isDirectory()) {
        hash.update(`directory\0${relative}\0`);
        visit(absolute);
      } else if (entry.isFile()) {
        hash.update(`file\0${relative}\0`);
        hash.update(readFileSync(absolute));
        hash.update("\0");
      } else if (entry.isSymbolicLink()) {
        hash.update(`symlink\0${relative}\0${readlinkSync(absolute)}\0`);
      } else {
        throw new Error(`unsupported cached source entry: ${relative}`);
      }
    }
  }
  visit(root);
  return hash.digest("hex");
}

function commandText(command: string, args: readonly string[]): string {
  return [command, ...args.map((arg) => JSON.stringify(arg))].join(" ");
}

function sanitized(value: string, haxeRoot?: string, utestRoot?: string): string {
  return value
    .split(path.relative(repoRoot, evidenceRoot))
    .join(path.relative(repoRoot, publicEvidenceRoot))
    .split(evidenceRoot).join(publicEvidenceRoot)
    .split(repoRoot).join("<repo>")
    .split(haxeRoot ?? "\0").join("<haxe-source>")
    .split(utestRoot ?? "\0").join("<utest-source>");
}

function publishedPath(file: string): string {
  const published = path.join(
    publicEvidenceRoot,
    path.relative(evidenceRoot, file)
  );
  return path.relative(repoRoot, published);
}

function runStage(
  id: string,
  command: string,
  args: readonly string[],
  cwd: string,
  logPath: string,
  haxeRoot?: string,
  utestRoot?: string,
  timeoutMs = stageTimeoutMs
): StageResult {
  const started = performance.now();
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1"
    },
    timeout: timeoutMs
  });
  const durationMs = performance.now() - started;
  const combined = sanitized(
    `${result.stdout ?? ""}${result.stderr ?? ""}`,
    haxeRoot,
    utestRoot
  );
  mkdirSync(path.dirname(logPath), {recursive: true});
  writeFileSync(logPath, combined);
  if (result.error !== undefined) {
    const timedOut = result.error.message.includes("ETIMEDOUT");
    throw new StageExecutionError({
      id,
      durationMs,
      command: sanitized(commandText(command, args), haxeRoot, utestRoot),
      log: publishedPath(logPath)
    }, combined,
      `${id} ${timedOut ? "timed out" : "failed to start"}: ${result.error.message}\n${combined}`
    );
  }
  if (result.status !== 0) {
    throw new StageExecutionError({
      id,
      durationMs,
      command: sanitized(commandText(command, args), haxeRoot, utestRoot),
      log: publishedPath(logPath)
    }, combined,
      `${id} failed with exit ${String(result.status)}\n${combined}`
    );
  }
  return {
    id,
    durationMs,
    command: sanitized(commandText(command, args), haxeRoot, utestRoot),
    log: publishedPath(logPath)
  };
}

function materializePinnedTree(
  id: "haxe" | "utest",
  repository: string,
  revision: string,
  explicitRepository: string | undefined,
  nearbyRepository: string | null
): SourceMaterialization {
  const destination = path.join(
    sourceCacheRoot,
    `${id}-v${manifest.sourceCacheSchema}-${revision}`
  );
  const marker = path.join(destination, ".genes-source.json");
  if (existsSync(marker)) {
    const parsed = JSON.parse(readFileSync(marker, "utf8")) as SourceMarker;
    assert(parsed.schemaVersion === manifest.sourceCacheSchema
      && parsed.repository === repository && parsed.revision === revision,
      `${id} source-cache marker does not match the manifest`);
    const actualTreeHash = sourceTreeHash(destination);
    const checkedTreeHash = injection === "cache-hash-drift" && id === "haxe"
      ? `injected-${actualTreeHash}` : actualTreeHash;
    assert(parsed.treeHash === checkedTreeHash,
      `${id} cached source tree differs from its reviewed revision`);
    return {
      root: destination,
      cacheHit: true,
      stages: []
    };
  }

  const stages: StageResult[] = [];
  mkdirSync(sourceCacheRoot, {recursive: true});
  const staging = path.join(
    sourceCacheRoot,
    `.${id}-${revision}-${process.pid}-${Date.now()}`
  );
  mkdirSync(staging, {recursive: true});
  const archivePath = path.join(staging, `${id}.tar`);
  const candidate = explicitRepository
    ?? (nearbyRepository !== null && existsSync(path.join(nearbyRepository, ".git"))
      ? nearbyRepository
      : undefined);

  if (candidate !== undefined) {
    stages.push(runStage(
      `${id}-archive`,
      "git",
      ["-C", candidate, "archive", "--format=tar", "-o", archivePath, revision],
      repoRoot,
      path.join(evidenceRoot, "setup", `${id}-archive.log`)
    ));
  } else {
    const clone = path.join(staging, "repository");
    stages.push(runStage(
      `${id}-clone`,
      "git",
      ["clone", "--quiet", "--filter=blob:none", "--no-checkout", repository, clone],
      repoRoot,
      path.join(evidenceRoot, "setup", `${id}-clone.log`)
    ));
    stages.push(runStage(
      `${id}-fetch`,
      "git",
      ["-C", clone, "fetch", "--quiet", "--depth=1", "origin", revision],
      repoRoot,
      path.join(evidenceRoot, "setup", `${id}-fetch.log`)
    ));
    stages.push(runStage(
      `${id}-archive`,
      "git",
      ["-C", clone, "archive", "--format=tar", "-o", archivePath, "FETCH_HEAD"],
      repoRoot,
      path.join(evidenceRoot, "setup", `${id}-archive.log`)
    ));
  }

  const extracted = path.join(staging, "tree");
  mkdirSync(extracted, {recursive: true});
  stages.push(runStage(
    `${id}-extract`,
    "tar",
    ["-xf", archivePath, "-C", extracted],
    repoRoot,
    path.join(evidenceRoot, "setup", `${id}-extract.log`)
  ));
  const sourceMarker: SourceMarker = {
    schemaVersion: 1,
    repository,
    revision,
    treeHash: sourceTreeHash(extracted)
  };
  writeFileSync(path.join(extracted, ".genes-source.json"),
    JSON.stringify(sourceMarker, null, 2) + "\n");
  if (existsSync(destination)) {
    rmSync(destination, {recursive: true, force: true});
  }
  renameSync(extracted, destination);
  rmSync(staging, {recursive: true, force: true});
  return {
    root: destination,
    cacheHit: false,
    stages
  };
}

function listFiles(root: string, extension: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full, extension));
    else if (entry.isFile() && full.endsWith(extension)) files.push(full);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function treeIdentity(root: string): string {
  const hash = createHash("sha256");
  for (const file of listFiles(root, "")) {
    hash.update(path.relative(root, file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function injects(profile: ProfileId, stage: string): boolean {
  return injectionProfile === profile && injection === stage;
}

function validateManifest(haxeRoot: string, utestRoot: string): void {
  assert(manifest.schemaVersion === 1,
    "portable Haxe smoke manifest schema must be 1");
  assert(manifest.sourceCacheSchema === 1,
    "portable Haxe runtime source-cache schema must be 1");
  assert(manifest.contract === laneConfig.contract,
    `portable Haxe ${lane} manifest contract changed unexpectedly`);
  assert(manifest.profiles.map((profile) => profile.id).join(",")
    === "classic-esm,typescript",
  "portable Haxe smoke must declare classic and TypeScript profiles");
  assert(existsSync(path.join(haxeRoot, manifest.haxe.licensePath)),
    "Pinned Haxe checkout is missing its declared license");
  assert(existsSync(path.join(utestRoot, manifest.utest.licensePath)),
    "Pinned utest checkout is missing its declared license");
  const utestPackage = JSON.parse(readFileSync(
    path.join(utestRoot, manifest.utest.licensePath),
    "utf8"
  )) as {license?: string};
  assert(utestPackage.license === manifest.utest.license,
    "Pinned utest checkout no longer declares the reviewed license");

  for (const source of manifest.sources) {
    const full = path.join(haxeRoot, source.path);
    assert(existsSync(full), `Pinned Haxe source is missing: ${source.path}`);
    assert(sha256File(full) === source.sha256,
      `Pinned Haxe source changed without classification: ${source.path}`);
  }
  const sourceFamilies = new Set(manifest.sources.map((source) => source.family));
  for (const required of ["language", "unitstd", "issue"])
    assert(sourceFamilies.has(required as SourceFamily),
      `Portable smoke is missing the ${required} family`);
  const activeIds = manifest.activeTests.map((test) => test.id);
  assert(new Set(activeIds).size === activeIds.length,
    "Portable smoke active-test IDs must be unique");
  if (lane === "smoke") {
    assert(manifest.activeTests.every((test) =>
      Number.isInteger(test.expectedAssertions)
      && (test.expectedAssertions ?? 0) > 0),
    "Every active portable smoke test must declare a positive assertion count");
    assert(Number.isInteger(manifest.expectedAssertionsPerProfile)
      && (manifest.expectedAssertionsPerProfile ?? 0) > 0,
    "Portable smoke must declare a positive per-profile assertion total");
    assert(manifest.activeTests.reduce(
      (total, test) => total + (test.expectedAssertions ?? 0),
      0
    ) === manifest.expectedAssertionsPerProfile,
    "Portable smoke per-test assertion counts do not match the reviewed total");
  } else {
    assert(manifest.executionScopes !== undefined,
      "Representative lane must declare quick, scheduled, and release scopes");
    assert(manifest.executionScopes.quick.representativeIncluded === false,
      "Quick scope must keep the representative lane separate");
    for (const scope of [
      manifest.executionScopes.scheduled,
      manifest.executionScopes.release
    ]) {
      assert(scope.representativeIncluded === true,
        "Scheduled and release scopes must include the representative lane");
      assert(scope.command === "yarn test:official-haxe-representative",
        "Scheduled and release scopes must use the stable representative command");
      assert(scope.enrollmentOwner.startsWith("genes-"),
        "Representative workflow enrollment must have a Bead owner");
    }
    const caseIds = manifest.activeTests.map((test) => test.caseId);
    assert(caseIds.every((caseId) => typeof caseId === "string"
      && caseId.length > 0),
    "Every representative test must declare a case ID");
    assert(new Set(caseIds).size === caseIds.length,
      "Representative case IDs must be unique");
    const inventories = manifest.profiles.map((profile) => JSON.parse(
      readFileSync(path.join(
        repoRoot,
        "tests",
        "official-haxe-inventory",
        "inventories",
        `${profile.id}.json`
      ), "utf8")
    ) as OfficialInventory);
    for (const test of manifest.activeTests) {
      assert(typeof test.define === "string" && test.define.length > 0,
        `${test.id} must declare its selection define`);
      assert(typeof test.source === "string" && test.source.length > 0,
        `${test.id} must declare its reviewed source`);
      assert(manifest.sources.some((source) => source.path === test.source),
        `${test.id} source is absent from the reviewed source inventory`);
      const officialSource = path.relative(
        path.join(repoRoot, "tests", "unit"),
        path.join(repoRoot, test.source)
      ).replaceAll("\\", "/");
      for (const inventory of inventories) {
        assert(inventory.haxeRevision === manifest.haxe.revision
          && inventory.utestRevision === manifest.utest.revision,
        `${inventory.profile} inventory uses different source revisions`);
        const registration = inventory.activeTests.find((candidate) =>
          candidate.id === test.id);
        assert(registration !== undefined,
          `${test.id} is absent from the ${inventory.profile} inventory`);
        assert(registration.source === officialSource,
          `${test.id} source differs from the ${inventory.profile} inventory`);
      }
      assert(test.expectedProfiles !== undefined,
        `${test.id} must declare both profile outcomes`);
      for (const profile of manifest.profiles) {
        const expected = test.expectedProfiles[profile.id];
        assert(expected !== undefined,
          `${test.id} is missing the ${profile.id} outcome`);
        if (expected.status === "pass") {
          assert(Number.isInteger(expected.assertions)
            && expected.assertions > 0,
          `${test.id} ${profile.id} must declare a positive assertion count`);
        } else {
          assert(expected.diagnostic.trim().length > 0,
            `${test.id} ${profile.id} known failure needs a diagnostic`);
          assert(expected.owner.startsWith("genes-"),
            `${test.id} ${profile.id} known failure needs a Bead owner`);
        }
      }
    }
  }
  assert(manifest.runnerAdaptation.disposition === "upstream-harness-adaptation",
    "Portable smoke must classify its local utest runner as an adaptation");
  assert(manifest.runnerAdaptation.reason.trim().length > 0,
    "Portable smoke runner adaptation requires a reviewable reason");
  for (const source of manifest.runnerAdaptation.upstream) {
    const full = path.join(utestRoot, source.path);
    assert(existsSync(full),
      `Pinned utest adaptation source is missing: ${source.path}`);
    assert(sha256File(full) === source.sha256,
      `Pinned utest adaptation source changed: ${source.path}`);
  }
  for (const source of manifest.runnerAdaptation.local) {
    const full = path.join(repoRoot, source.path);
    assert(existsSync(full),
      `Portable smoke adaptation file is missing: ${source.path}`);
    assert(sha256File(full) === source.sha256,
      `Portable smoke adaptation changed without review: ${source.path}`);
  }
}

function packageCompiler(): {root: string; stages: StageResult[]} {
  const sourceRoot = path.join(dependencyRoot, "genes-package-source");
  const packageRoot = path.join(dependencyRoot, "genes-package");
  const archive = path.join(dependencyRoot, "genes.zip");
  const copyStarted = performance.now();
  rmSync(sourceRoot, {recursive: true, force: true});
  rmSync(packageRoot, {recursive: true, force: true});
  mkdirSync(sourceRoot, {recursive: true});
  mkdirSync(packageRoot, {recursive: true});
  for (const relative of ["src", "haxelib.json", "readme.md", "extraParams.hxml"])
    cpSync(path.join(repoRoot, relative), path.join(sourceRoot, relative), {
      recursive: true
    });
  const copyLog = path.join(evidenceRoot, "setup", "package-genes.log");
  mkdirSync(path.dirname(copyLog), {recursive: true});
  writeFileSync(
    copyLog,
    "Copied the current working-tree package inputs: "
    + "src, haxelib.json, readme.md, extraParams.hxml\n"
  );
  const copyStage: StageResult = {
    id: "copy-genes-working-tree",
    durationMs: performance.now() - copyStarted,
    command: "copy current working-tree package inputs",
    log: publishedPath(copyLog)
  };
  const zipStage = runStage(
    "package-genes",
    "zip",
    ["-q", "-r", archive, "."],
    sourceRoot,
    path.join(evidenceRoot, "setup", "zip-genes.log")
  );
  const extractStage = runStage(
    "extract-genes",
    "unzip",
    ["-q", archive, "-d", packageRoot],
    repoRoot,
    path.join(evidenceRoot, "setup", "extract-genes.log")
  );
  assert(existsSync(path.join(packageRoot, "src", "genes", "Generator.hx")),
    "Packaged Genes artifact is missing genes.Generator");
  assert(treeIdentity(packageRoot) === treeIdentity(sourceRoot),
    "Extracted Genes package differs from the current working-tree snapshot");
  return {root: packageRoot, stages: [copyStage, zipStage, extractStage]};
}

function haxeArguments(
  profile: ProfileId,
  output: string,
  compilerRoot: string,
  haxeRoot: string,
  utestRoot: string,
  representativeCase?: ActiveTestRecord
): string[] {
  const unitStdRoot = path.join(haxeRoot, "tests", "unit", "src", "unitstd");
  const fixtureClassPaths = lane === "smoke"
    ? [path.join(fixtureRoot, "src")]
    : [
        path.join(repoRoot, "tests", "portable-haxe-smoke", "src"),
        path.join(fixtureRoot, "src")
      ];
  return [
    path.join(compilerRoot, "extraParams.hxml"),
    "-cp", path.join(compilerRoot, "src"),
    "-cp", path.join(haxeRoot, "tests", "unit", "src"),
    ...fixtureClassPaths.flatMap((classPath) => ["-cp", classPath]),
    "-lib", "helder.set",
    "-lib", "hxnodejs",
    "-main", injects(profile, "generation")
      ? "portable.PortableSmokeMissingMain"
      : laneConfig.main,
    "-dce", "full",
    "-debug",
    "-D", "nodejs",
    "-D", "message.reporting=pretty",
    ...(lane === "smoke" ? [
      "-D",
      `genes.portable.unitstd_path=${path.join(unitStdRoot, "IntIterator.unit.hx")}`
    ] : [
      "-D", representativeCase?.define ?? "missing-representative-case",
      "-D", `genes.representative.unitstd_path=${path.join(
        haxeRoot,
        representativeCase?.source ?? "missing-representative-source"
      )}`
    ]),
    ...(injects(profile, "assertion")
      ? ["-D", "genes.portable.inject_assertion_failure"]
      : []),
    ...(injects(profile, "assertion-count")
      ? ["-D", "genes.portable.inject_missing_assertion_count"]
      : []),
    ...(injects(profile, "missing-active")
      ? ["-D", "genes.portable.inject_missing_active"]
      : []),
    ...(profile === "typescript" ? ["-D", "genes.ts"] : []),
    "-js", output
  ];
}

function runtimeResult(output: string, profile: ProfileId): RuntimeResult {
  const marker = "GENES_PORTABLE_HAXE_RESULT=";
  const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith(marker));
  assert(line !== undefined, `${profile} runtime did not emit its machine result`);
  const parsed = JSON.parse(line.slice(marker.length)) as RuntimeResult;
  assert(parsed.profile === profile,
    `${profile} runtime reported the wrong profile: ${parsed.profile}`);
  assert(Array.isArray(parsed.activeTests)
    && parsed.activeTests.every((id) => typeof id === "string"),
  `${profile} runtime emitted an invalid active-test list`);
  assert(Array.isArray(parsed.tests)
    && parsed.tests.every((test) =>
      typeof test.id === "string"
      && Number.isInteger(test.assertions)
      && test.assertions > 0
      && Number.isInteger(test.failures)
      && test.failures >= 0),
  `${profile} runtime emitted invalid per-test results`);
  assert(Number.isInteger(parsed.assertions) && parsed.assertions > 0,
    `${profile} runtime executed no assertions`);
  assert(parsed.failures === 0,
    `${profile} runtime reported ${parsed.failures} failure(s)`);
  return parsed;
}

function runProfile(
  profile: ProfileId,
  compilerRoot: string,
  haxeRoot: string,
  utestRoot: string,
  representativeCase?: ActiveTestRecord
): ProfileReport {
  const profileRoot = representativeCase === undefined
    ? path.join(evidenceRoot, profile)
    : path.join(evidenceRoot, profile, "cases", representativeCase.caseId ?? "missing");
  const sourceRoot = path.join(profileRoot, "source");
  const runtimeRoot = path.join(profileRoot, "runtime");
  const logsRoot = path.join(profileRoot, "logs");
  rmSync(profileRoot, {recursive: true, force: true});
  mkdirSync(sourceRoot, {recursive: true});
  mkdirSync(runtimeRoot, {recursive: true});
  const extension = profile === "typescript" ? "ts" : "js";
  const entry = path.join(sourceRoot, `index.${extension}`);
  const stages: StageResult[] = [];

  stages.push(runStage(
    `${profile}-haxe-generation`,
    "haxe",
    haxeArguments(
      profile,
      entry,
      compilerRoot,
      haxeRoot,
      utestRoot,
      representativeCase
    ),
    repoRoot,
    path.join(logsRoot, "haxe.log"),
    haxeRoot,
    utestRoot
  ));

  let runtimeEntry = entry;
  if (profile === "classic-esm") {
    if (injects(profile, "javascript-syntax"))
      writeFileSync(entry, `${readFileSync(entry, "utf8")}\nthis is not valid JavaScript !!!\n`);
    writeFileSync(path.join(sourceRoot, "package.json"), "{\"type\":\"module\"}\n");
    for (const file of listFiles(sourceRoot, ".js")) {
      stages.push(runStage(
        `${profile}-node-check-${path.relative(sourceRoot, file)}`,
        "node",
        ["--check", file],
        repoRoot,
        path.join(logsRoot, `node-check-${path.basename(file)}.log`),
        haxeRoot,
        utestRoot
      ));
    }
  } else {
    if (injects(profile, "typescript-strict"))
      writeFileSync(entry, `${readFileSync(entry, "utf8")}\nconst __genesInjectedTypeFailure: number = "wrong";\n`);
    const tsconfig = path.join(profileRoot, "tsconfig.json");
    writeFileSync(tsconfig, JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        types: ["node"],
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        skipLibCheck: false,
        sourceMap: true,
        rootDir: sourceRoot,
        outDir: runtimeRoot
      },
      include: [path.join(sourceRoot, "**", "*.ts")]
    }, null, 2) + "\n");
    writeFileSync(path.join(sourceRoot, "package.json"), "{\"type\":\"module\"}\n");
    writeFileSync(path.join(runtimeRoot, "package.json"), "{\"type\":\"module\"}\n");
    stages.push(runStage(
      `${profile}-strict-typescript`,
      "node",
      ["scripts/run-typescript.mjs", "legacyFloor", "-p", tsconfig],
      repoRoot,
      path.join(logsRoot, "typescript.log"),
      haxeRoot,
      utestRoot
    ));
    runtimeEntry = path.join(runtimeRoot, "index.js");
  }

  if (injects(profile, "module-load"))
    writeFileSync(runtimeEntry, 'import "./genes-portable-missing-module.js";\n');
  if (injects(profile, "runtime-exception"))
    writeFileSync(runtimeEntry, 'throw new Error("injected portable smoke runtime failure");\n');
  if (injects(profile, "timeout"))
    writeFileSync(runtimeEntry, "setInterval(() => {}, 1000);\n");

  const runtimeStage = runStage(
    `${profile}-node-runtime`,
    "node",
    [runtimeEntry],
    repoRoot,
    path.join(logsRoot, "runtime.log"),
    haxeRoot,
    utestRoot,
    runtimeTimeoutMs
  );
  stages.push(runtimeStage);
  const result = runtimeResult(
    readFileSync(path.join(logsRoot, "runtime.log"), "utf8"),
    profile
  );
  return {
    profile,
    status: "pass",
    result,
    stages,
    artifacts: [
      publishedPath(sourceRoot),
      publishedPath(runtimeRoot),
      publishedPath(logsRoot)
    ]
  };
}

function failurePhase(stageId: string): FailurePhase {
  if (stageId.endsWith("-haxe-generation")) return "generation";
  if (stageId.endsWith("-node-runtime")) return "runtime";
  return "target-check";
}

function representativeArtifacts(
  profile: ProfileId,
  test: ActiveTestRecord
): string[] {
  const root = path.join(
    evidenceRoot,
    profile,
    "cases",
    test.caseId ?? "missing"
  );
  return ["source", "runtime", "logs"]
    .map((name) => path.join(root, name))
    .filter((artifact) => existsSync(artifact))
    .map(publishedPath);
}

function runRepresentativeProfile(
  test: ActiveTestRecord,
  profile: ProfileId,
  compilerRoot: string,
  haxeRoot: string,
  utestRoot: string
): CaseProfileReport {
  const expected = test.expectedProfiles?.[profile];
  assert(expected !== undefined,
    `${test.id} has no reviewed ${profile} outcome`);
  try {
    const report = runProfile(
      profile,
      compilerRoot,
      haxeRoot,
      utestRoot,
      test
    );
    assert(expected.status === "pass",
      `${test.id} ${profile} unexpectedly passed; review its owned limitation`);
    assert(JSON.stringify(report.result.activeTests) === JSON.stringify([test.id]),
      `${test.id} ${profile} executed a different official method`);
    assert(report.result.tests.length === 1
      && report.result.tests[0]?.id === test.id,
    `${test.id} ${profile} emitted an invalid per-test result`);
    assert(report.result.assertions === expected.assertions,
      `${test.id} ${profile} assertion count changed: `
      + `expected=${expected.assertions}, actual=${report.result.assertions}`);
    return report;
  } catch (error) {
    if (!(error instanceof StageExecutionError)) throw error;
    assert(expected.status === "known-failure",
      `${test.id} ${profile} failed unexpectedly at ${error.stage.id}\n${error.message}`);
    const actualPhase = failurePhase(error.stage.id);
    assert(actualPhase === expected.phase,
      `${test.id} ${profile} failure phase changed: `
      + `expected=${expected.phase}, actual=${actualPhase}`);
    assert(error.stageLog.includes(expected.diagnostic),
      `${test.id} ${profile} failure diagnostic changed: `
      + `expected substring=${JSON.stringify(expected.diagnostic)}\n${error.message}`);
    return {
      profile,
      status: "known-failure",
      phase: actualPhase,
      diagnostic: expected.diagnostic,
      owner: expected.owner,
      stages: [error.stage],
      artifacts: representativeArtifacts(profile, test)
    };
  }
}

function publishEvidence(stagingRoot: string): void {
  const backup = `${publicEvidenceRoot}.previous-${process.pid}`;
  rmSync(backup, {recursive: true, force: true});
  if (existsSync(publicEvidenceRoot)) renameSync(publicEvidenceRoot, backup);
  try {
    if (injection === "publication")
      throw new Error("injected portable smoke publication failure");
    renameSync(stagingRoot, publicEvidenceRoot);
    rmSync(backup, {recursive: true, force: true});
  } catch (error) {
    if (existsSync(publicEvidenceRoot))
      rmSync(publicEvidenceRoot, {recursive: true, force: true});
    if (existsSync(backup)) renameSync(backup, publicEvidenceRoot);
    throw error;
  }
}

function retainFailureEvidence(stagingRoot: string): string {
  const failureRoot = path.join(
    path.dirname(publicEvidenceRoot),
    `${laneConfig.fixture}-failures`
  );
  mkdirSync(failureRoot, {recursive: true});
  const destination = path.join(
    failureRoot,
    `${new Date().toISOString().replaceAll(":", "-")}-${process.pid}`
  );
  renameSync(stagingRoot, destination);
  return path.relative(repoRoot, destination);
}

function run(): void {
  const started = performance.now();
  mkdirSync(path.dirname(publicEvidenceRoot), {recursive: true});
  const stagingRoot = path.join(
    path.dirname(publicEvidenceRoot),
    `.${laneConfig.fixture}-stage-${process.pid}-${Date.now()}`
  );
  rmSync(stagingRoot, {recursive: true, force: true});
  evidenceRoot = stagingRoot;
  dependencyRoot = path.join(evidenceRoot, "dependencies");
  mkdirSync(evidenceRoot, {recursive: true});
  try {
    const haxeSource = materializePinnedTree(
      "haxe",
      manifest.haxe.repository,
      manifest.haxe.revision,
      process.env.GENES_HAXE_SOURCE_REPOSITORY,
      path.resolve(repoRoot, "../haxe")
    );
    const utestSource = materializePinnedTree(
      "utest",
      manifest.utest.repository,
      manifest.utest.revision,
      process.env.GENES_UTEST_SOURCE_REPOSITORY,
      null
    );
    const haxeRoot = haxeSource.root;
    const utestRoot = utestSource.root;
    validateManifest(haxeRoot, utestRoot);
    const packaged = packageCompiler();
    const expected = manifest.activeTests
      .map((test) => test.id)
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    let profiles: ProfileReport[] | Array<{
      profile: ProfileId;
      cases: Array<{id: string; outcome: CaseProfileReport}>;
    }>;
    let summary: string;
    if (lane === "smoke") {
      const smokeProfiles = (["classic-esm", "typescript"] as const)
        .map((profile) => runProfile(
          profile,
          packaged.root,
          haxeRoot,
          utestRoot
        ));
      const expectedAssertions = new Map(
        manifest.activeTests.map((test) => [test.id, test.expectedAssertions])
      );
      for (const profile of smokeProfiles) {
        assert(JSON.stringify(profile.result.activeTests) === JSON.stringify(expected),
          `${profile.profile} active inventory differs from the reviewed manifest\n`
          + `expected=${JSON.stringify(expected)}\n`
          + `actual=${JSON.stringify(profile.result.activeTests)}`);
        assert(JSON.stringify(profile.result.tests.map((test) => test.id))
          === JSON.stringify(expected),
        `${profile.profile} per-test results differ from the reviewed inventory`);
        assert(profile.result.tests.every((test) => test.failures === 0),
          `${profile.profile} reported a failing active test`);
        for (const test of profile.result.tests) {
          assert(test.assertions === expectedAssertions.get(test.id),
            `${profile.profile} assertion count differs for ${test.id}: `
            + `expected=${String(expectedAssertions.get(test.id))}, `
            + `actual=${String(test.assertions)}`);
        }
        assert(profile.result.assertions === manifest.expectedAssertionsPerProfile,
          `${profile.profile} assertion total differs from the reviewed manifest: `
          + `expected=${String(manifest.expectedAssertionsPerProfile)}, `
          + `actual=${String(profile.result.assertions)}`);
      }
      assert(smokeProfiles[0]?.result.assertions
        === smokeProfiles[1]?.result.assertions,
      "Classic and TypeScript smoke profiles executed different assertion counts");
      assert(JSON.stringify(smokeProfiles[0]?.result.tests)
        === JSON.stringify(smokeProfiles[1]?.result.tests),
      "Classic and TypeScript smoke profiles produced different per-test outcomes");
      profiles = smokeProfiles;
      summary = `${smokeProfiles[0]?.result.assertions ?? 0} assertions/profile`;
    } else {
      const representativeProfiles = (["classic-esm", "typescript"] as const)
        .map((profile) => ({
        profile,
        cases: manifest.activeTests.map((test) => ({
          id: test.id,
          outcome: runRepresentativeProfile(
            test,
            profile,
            packaged.root,
            haxeRoot,
            utestRoot
          )
        }))
      }));
      const knownFailures = representativeProfiles.reduce((total, profile) =>
        total + profile.cases.filter((test) =>
          test.outcome.status === "known-failure").length, 0);
      profiles = representativeProfiles;
      summary = `${knownFailures} owned known failures across separate profile outcomes`;
    }

    const toolchains = JSON.parse(readFileSync(
      path.join(repoRoot, "config", "toolchains.json"),
      "utf8"
    )) as {
      node: {stable: string};
      typescript: {legacyFloor: {version: string}};
    };

    const report = {
      schemaVersion: 1,
      contract: manifest.contract,
      status: "pass",
      claim: manifest.claim,
      haxe: {
        version: manifest.haxe.version,
        revision: manifest.haxe.revision
      },
      utest: {
        revision: manifest.utest.revision
      },
      runnerAdaptation: {
        disposition: manifest.runnerAdaptation.disposition,
        reason: manifest.runnerAdaptation.reason,
        upstream: manifest.runnerAdaptation.upstream,
        local: manifest.runnerAdaptation.local
      },
      executionScopes: manifest.executionScopes,
      toolchains: {
        haxe: manifest.haxe.version,
        node: process.version,
        configuredNodeLane: toolchains.node.stable,
        typescript: toolchains.typescript.legacyFloor.version
      },
      sourceInventory: manifest.sources,
      cache: {
        mode: "warm-allowed",
        dependencies: path.relative(repoRoot, sourceCacheRoot),
        sources: [
          {id: "haxe", hit: haxeSource.cacheHit},
          {id: "utest", hit: utestSource.cacheHit}
        ]
      },
      retries: 0,
      flakes: [],
      profiles,
      preparation: [
        ...haxeSource.stages,
        ...utestSource.stages,
        ...packaged.stages
      ],
      totalDurationMs: performance.now() - started
    };
    const reportPath = path.join(evidenceRoot, "report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    publishEvidence(stagingRoot);
    console.log(
      `portable-haxe-${lane}:ok (${expected.length} active tests, `
      + `${summary}, `
      + `${report.totalDurationMs.toFixed(1)}ms; `
      + `${path.relative(repoRoot, path.join(publicEvidenceRoot, "report.json"))})`
    );
  } catch (error) {
    const retained = retainFailureEvidence(stagingRoot);
    console.error(`portable-haxe-${lane}:failure-artifacts ${retained}`);
    throw error;
  }
}

run();
