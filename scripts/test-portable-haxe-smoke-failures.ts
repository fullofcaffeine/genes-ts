import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync
} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

interface FailureCase {
  injection: string;
  profile: "classic-esm" | "typescript";
  timeoutMs: number;
  expectedText: string;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const runner = path.join(
  repoRoot,
  "scripts",
  "dist",
  "test-portable-haxe-smoke.js"
);
const publicEvidence = path.join(
  repoRoot,
  ".tmp",
  "test-evidence",
  "portable-haxe-smoke"
);
const failureEvidence = path.join(
  repoRoot,
  ".tmp",
  "test-evidence",
  "portable-haxe-smoke-failures"
);
const cases: FailureCase[] = [
  {
    injection: "cache-hash-drift",
    profile: "classic-esm",
    timeoutMs: 120_000,
    expectedText: "cached source tree differs from its reviewed revision"
  },
  {
    injection: "generation",
    profile: "classic-esm",
    timeoutMs: 120_000,
    expectedText: "PortableSmokeMissingMain"
  },
  {
    injection: "javascript-syntax",
    profile: "classic-esm",
    timeoutMs: 120_000,
    expectedText: "node-check-index.js"
  },
  {
    injection: "typescript-strict",
    profile: "typescript",
    timeoutMs: 120_000,
    expectedText: "Type 'string' is not assignable to type 'number'"
  },
  {
    injection: "module-load",
    profile: "classic-esm",
    timeoutMs: 120_000,
    expectedText: "ERR_MODULE_NOT_FOUND"
  },
  {
    injection: "assertion",
    profile: "classic-esm",
    timeoutMs: 120_000,
    expectedText: "injected failure"
  },
  {
    injection: "assertion-count",
    profile: "classic-esm",
    timeoutMs: 120_000,
    expectedText: "assertion count differs"
  },
  {
    injection: "runtime-exception",
    profile: "classic-esm",
    timeoutMs: 120_000,
    expectedText: "injected portable smoke runtime failure"
  },
  {
    injection: "timeout",
    profile: "classic-esm",
    timeoutMs: 500,
    expectedText: "timed out"
  },
  {
    injection: "publication",
    profile: "classic-esm",
    timeoutMs: 120_000,
    expectedText: "injected portable smoke publication failure"
  },
  {
    injection: "missing-active",
    profile: "classic-esm",
    timeoutMs: 120_000,
    expectedText: "active inventory differs"
  }
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function files(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...files(full));
    else if (entry.isFile()) result.push(full);
  }
  return result.sort((left, right) => left.localeCompare(right));
}

function treeHash(root: string): string {
  const hash = createHash("sha256");
  for (const file of files(root)) {
    hash.update(path.relative(root, file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function run(environment: NodeJS.ProcessEnv = {}): {
  status: number | null;
  output: string;
} {
  const result = spawnSync(process.execPath, [runner], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...environment,
      NO_COLOR: "1"
    },
    timeout: 150_000
  });
  if (result.error !== undefined) throw result.error;
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`
  };
}

/**
 * Proves that every important portable-smoke failure remains red.
 *
 * The test first publishes one known-good evidence tree. It then injects
 * source-cache drift, generation and target errors, assertion failures,
 * runtime failures, publication rollback, and missing active evidence. Every
 * attempt must exit nonzero, name its failure, retain a separate diagnostic
 * tree, and leave the public last-good evidence tree byte-identical.
 */
function main(): void {
  rmSync(failureEvidence, {recursive: true, force: true});
  if (process.env.GENES_PORTABLE_SMOKE_BASELINE_READY !== "1") {
    const baseline = run();
    assert(baseline.status === 0,
      `Unable to seed portable smoke evidence:\n${baseline.output}`);
  }
  assert(existsSync(path.join(publicEvidence, "report.json")),
    "Portable smoke did not publish its machine report");
  const baselineHash = treeHash(publicEvidence);

  for (const failure of cases) {
    const outcome = run({
      GENES_PORTABLE_SMOKE_INJECT: failure.injection,
      GENES_PORTABLE_SMOKE_INJECT_PROFILE: failure.profile,
      GENES_PORTABLE_SMOKE_RUNTIME_TIMEOUT_MS: String(failure.timeoutMs)
    });
    assert(outcome.status !== 0,
      `${failure.injection} unexpectedly reported success`);
    assert(outcome.output.includes(failure.expectedText),
      `${failure.injection} did not expose ${failure.expectedText}\n${outcome.output}`);
    assert(outcome.output.includes("portable-haxe-smoke:failure-artifacts"),
      `${failure.injection} did not retain failure artifacts`);
    assert(treeHash(publicEvidence) === baselineHash,
      `${failure.injection} changed the last-good public evidence tree`);
  }

  const retained = existsSync(failureEvidence)
    ? readdirSync(failureEvidence, {withFileTypes: true})
      .filter((entry) => entry.isDirectory()).length
    : 0;
  assert(retained === cases.length,
    `Expected ${cases.length} retained failure trees, found ${retained}`);
  console.log(
    `portable-haxe-smoke-failures:ok (${cases.length} nonzero stages; last-good ${baselineHash.slice(0, 12)})`
  );
}

main();
