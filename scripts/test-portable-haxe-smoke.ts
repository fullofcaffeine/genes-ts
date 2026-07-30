import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { performance } from "node:perf_hooks";

type SourceFamily = "harness" | "language" | "unitstd" | "issue";
type ProfileId = "classic-esm" | "typescript";

interface SourceRecord {
  family: SourceFamily;
  path: string;
  sha256: string;
}

interface ActiveTestRecord {
  id: string;
  family: Exclude<SourceFamily, "harness">;
  expectedAssertions: number;
}

interface FileIdentity {
  path: string;
  sha256: string;
}

interface PortableManifest {
  schemaVersion: number;
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
  expectedAssertionsPerProfile: number;
  profiles: Array<{id: ProfileId}>;
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
  result: RuntimeResult;
  stages: StageResult[];
  artifacts: string[];
}

interface SourceMaterialization {
  root: string;
  cacheHit: boolean;
  stages: StageResult[];
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const fixtureRoot = path.join(repoRoot, "tests", "portable-haxe-smoke");
const manifestPath = path.join(fixtureRoot, "manifest.json");
const publicEvidenceRoot = path.join(
  repoRoot,
  ".tmp",
  "test-evidence",
  "portable-haxe-smoke"
);
let evidenceRoot = publicEvidenceRoot;
let dependencyRoot = path.join(evidenceRoot, "dependencies");
const sourceCacheRoot = path.join(repoRoot, ".cache", "portable-haxe-smoke");
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

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
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
    throw new Error(
      `${id} ${timedOut ? "timed out" : "failed to start"}: ${result.error.message}\n${combined}`
    );
  }
  if (result.status !== 0) {
    throw new Error(
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
  const destination = path.join(sourceCacheRoot, `${id}-${revision}`);
  const marker = path.join(destination, ".genes-source.json");
  if (existsSync(marker)) {
    const parsed = JSON.parse(readFileSync(marker, "utf8")) as {
      repository: string;
      revision: string;
    };
    assert(parsed.repository === repository && parsed.revision === revision,
      `${id} source-cache marker does not match the manifest`);
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
  writeFileSync(path.join(extracted, ".genes-source.json"), JSON.stringify({
    repository,
    revision
  }, null, 2) + "\n");
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
  assert(manifest.contract === "genes-official-haxe-smoke",
    "portable Haxe smoke manifest contract changed unexpectedly");
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
  assert(manifest.activeTests.every((test) =>
    Number.isInteger(test.expectedAssertions)
    && test.expectedAssertions > 0),
  "Every active portable smoke test must declare a positive assertion count");
  assert(Number.isInteger(manifest.expectedAssertionsPerProfile)
    && manifest.expectedAssertionsPerProfile > 0,
  "Portable smoke must declare a positive per-profile assertion total");
  assert(manifest.activeTests.reduce(
    (total, test) => total + test.expectedAssertions,
    0
  ) === manifest.expectedAssertionsPerProfile,
  "Portable smoke per-test assertion counts do not match the reviewed total");
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
  utestRoot: string
): string[] {
  const unitStd = path.join(
    haxeRoot,
    "tests",
    "unit",
    "src",
    "unitstd",
    "IntIterator.unit.hx"
  );
  return [
    path.join(compilerRoot, "extraParams.hxml"),
    "-cp", path.join(compilerRoot, "src"),
    "-cp", path.join(haxeRoot, "tests", "unit", "src"),
    "-cp", path.join(fixtureRoot, "src"),
    "-lib", "helder.set",
    "-lib", "hxnodejs",
    "-main", injects(profile, "generation")
      ? "portable.PortableSmokeMissingMain"
      : "portable.PortableSmokeMain",
    "-dce", "full",
    "-debug",
    "-D", "nodejs",
    "-D", "message.reporting=pretty",
    "-D", `genes.portable.unitstd_path=${unitStd}`,
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
  utestRoot: string
): ProfileReport {
  const profileRoot = path.join(evidenceRoot, profile);
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
    haxeArguments(profile, entry, compilerRoot, haxeRoot, utestRoot),
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
    result,
    stages,
    artifacts: [
      publishedPath(sourceRoot),
      publishedPath(runtimeRoot),
      publishedPath(logsRoot)
    ]
  };
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
    "portable-haxe-smoke-failures"
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
    `.portable-haxe-smoke-stage-${process.pid}-${Date.now()}`
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
    const profiles = (["classic-esm", "typescript"] as const).map((profile) =>
      runProfile(profile, packaged.root, haxeRoot, utestRoot));

    const expected = manifest.activeTests
      .map((test) => test.id)
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    const expectedAssertions = new Map(
      manifest.activeTests.map((test) => [test.id, test.expectedAssertions])
    );
    for (const profile of profiles) {
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
    assert(profiles[0].result.assertions === profiles[1].result.assertions,
      "Classic and TypeScript smoke profiles executed different assertion counts");
    assert(JSON.stringify(profiles[0].result.tests)
      === JSON.stringify(profiles[1].result.tests),
    "Classic and TypeScript smoke profiles produced different per-test outcomes");

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
      `portable-haxe-smoke:ok (${expected.length} active tests, `
      + `${profiles[0].result.assertions} assertions/profile, `
      + `${report.totalDurationMs.toFixed(1)}ms; `
      + `${path.relative(repoRoot, path.join(publicEvidenceRoot, "report.json"))})`
    );
  } catch (error) {
    const retained = retainFailureEvidence(stagingRoot);
    console.error(`portable-haxe-smoke:failure-artifacts ${retained}`);
    throw error;
  }
}

run();
