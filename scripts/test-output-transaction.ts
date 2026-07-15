import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const fixtureRoot = path.join(repoRoot, "tests/output-transaction");

type Profile = {
  readonly id: "ts" | "classic";
  readonly hxml: string;
  readonly implementation: string;
  readonly stale: ReadonlyArray<string>;
};

const profiles: ReadonlyArray<Profile> = [
  {
    id: "ts",
    hxml: "tests/output-transaction/build-ts.hxml",
    implementation: "transaction/MarkerA.ts",
    stale: ["transaction/StaleMarker.ts", "transaction/StaleMarker.ts.map"]
  },
  {
    id: "classic",
    hxml: "tests/output-transaction/build-classic.hxml",
    implementation: "transaction/MarkerA.js",
    stale: [
      "transaction/StaleMarker.js",
      "transaction/StaleMarker.js.map",
      "transaction/StaleMarker.d.ts",
      "transaction/StaleMarker.d.ts.map"
    ]
  }
];

/**
 * Runs a real compiler profile with optional private fault-injection defines.
 *
 * Why: a unit test of the filesystem helper cannot prove that every compiler
 * artifact actually uses it. These builds cover implementation modules,
 * source maps, TS support output, classic declarations, and the manifest.
 *
 * What/How: successful builds throw on any nonzero Haxe result. Expected
 * failures are captured separately so the harness can compare the complete
 * output tree before and after the compiler exits.
 */
function run(profile: Profile, defines: ReadonlyArray<string>): void {
  execFileSync("haxe", [
    profile.hxml,
    ...defines.flatMap((define) => ["-D", define])
  ], {
    cwd: repoRoot,
    stdio: "inherit"
  });
}

function expectFailure(
  profile: Profile,
  defines: ReadonlyArray<string>,
  diagnostic: string
): void {
  const result = spawnSync("haxe", [
    profile.hxml,
    ...defines.flatMap((define) => ["-D", define])
  ], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  ok(result.status !== 0, `${profile.id}: injected compiler failure succeeded`);
  const output = `${result.stdout}${result.stderr}`;
  ok(
    output.includes(diagnostic),
    `${profile.id}: missing injected diagnostic ${diagnostic}\n${output}`
  );
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  function walk(directory: string): void {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  walk(root);
  return files.sort((left, right) => left.localeCompare(right));
}

/** Captures byte hashes, including the ownership manifest and user asset. */
function captureTree(root: string): Readonly<Record<string, string>> {
  const entries: Array<readonly [string, string]> = [];
  for (const absolute of walkFiles(root)) {
    const relative = path.relative(root, absolute).replaceAll("\\", "/");
    entries.push([
      relative,
      createHash("sha256").update(readFileSync(absolute)).digest("hex")
    ]);
  }
  return Object.fromEntries(entries);
}

function manifestPaths(outputRoot: string): string[] {
  const manifest = path.join(outputRoot, ".genes-output-index.manifest");
  ok(existsSync(manifest), `Missing output ownership manifest: ${manifest}`);
  const lines = readFileSync(manifest, "utf8").replaceAll("\r", "").split("\n");
  strictEqual(lines.shift(), "genes-output-manifest-v1");
  return lines.filter((line) => line.length > 0);
}

function assertNoTransactionDebris(outputRoot: string): void {
  for (const absolute of walkFiles(outputRoot)) {
    const relative = path.relative(outputRoot, absolute).replaceAll("\\", "/");
    ok(!relative.includes(".genes-output-index.stage"),
      `Transaction staging file leaked: ${relative}`);
  }
  const direct = existsSync(outputRoot)
    ? readdirSync(outputRoot)
    : [];
  ok(!direct.includes(".genes-output-index.stage"),
    "Transaction staging directory leaked");
}

rmSync(path.join(fixtureRoot, "out"), { recursive: true, force: true });

for (const profile of profiles) {
  const outputRoot = path.join(fixtureRoot, "out", profile.id);
  const userAsset = path.join(outputRoot, "assets/user-owned.txt");
  const initialDefines = ["output_transaction_include_stale"];

  run(profile, initialDefines);
  mkdirSync(path.dirname(userAsset), { recursive: true });
  writeFileSync(userAsset, `user-owned-${profile.id}\n`, "utf8");
  for (const relative of profile.stale)
    ok(existsSync(path.join(outputRoot, relative)),
      `${profile.id}: initial build did not create ${relative}`);

  const initial = captureTree(outputRoot);
  const failedVariant = [
    "output_transaction_include_stale",
    "output_transaction_v2"
  ];

  expectFailure(
    profile,
    [...failedVariant, "genes.output_transaction_test_fail_before_commit"],
    "Genes output transaction test failure before publication"
  );
  deepStrictEqual(
    captureTree(outputRoot),
    initial,
    `${profile.id}: pre-publication failure changed the prior tree`
  );
  assertNoTransactionDebris(outputRoot);

  expectFailure(
    profile,
    [...failedVariant, "genes.output_transaction_test_fail_during_commit"],
    "Genes output transaction test failure during publication"
  );
  deepStrictEqual(
    captureTree(outputRoot),
    initial,
    `${profile.id}: publication rollback did not restore the prior tree`
  );
  assertNoTransactionDebris(outputRoot);

  run(profile, ["output_transaction_v2"]);
  const implementation = readFileSync(
    path.join(outputRoot, profile.implementation),
    "utf8"
  );
  ok(implementation.includes("published-v2-a"),
    `${profile.id}: successful transaction did not publish v2`);
  for (const relative of profile.stale)
    ok(!existsSync(path.join(outputRoot, relative)),
      `${profile.id}: stale owned path survived: ${relative}`);
  strictEqual(readFileSync(userAsset, "utf8"), `user-owned-${profile.id}\n`);
  const owned = manifestPaths(outputRoot);
  ok(owned.includes(profile.implementation),
    `${profile.id}: manifest omitted ${profile.implementation}`);
  ok(!owned.some((relative) => relative.includes("StaleMarker")),
    `${profile.id}: manifest retained the stale module`);
  assertNoTransactionDebris(outputRoot);

  const published = captureTree(outputRoot);
  run(profile, ["output_transaction_v2"]);
  deepStrictEqual(
    captureTree(outputRoot),
    published,
    `${profile.id}: identical rebuild changed the output tree`
  );
  assertNoTransactionDebris(outputRoot);
}

console.log("output-transaction:ok (TS + classic + declarations + rollback + stale ownership)");
