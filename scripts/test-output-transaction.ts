import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const fixtureRoot = path.join(repoRoot, "tests/output-transaction");
const writerFixtureRoot = path.join(repoRoot, "tests/writer");

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

/** Executes the standalone buffered writer through the pinned Haxe compiler. */
function runBufferedWriter(file: string, payload: string): void {
  execFileSync("haxe", [
    "-cp",
    "src",
    "-cp",
    "tests/writer/src",
    "-D",
    "genes.unchanged_no_rewrite",
    "--run",
    "writerevidence.Main",
    file,
    payload
  ], {
    cwd: repoRoot,
    stdio: "inherit"
  });
}

/**
 * Proves the fallback writer catches comparison failures, not publication
 * failures, and keeps that boundary strongly typed in Haxe source.
 */
function assertBufferedWriterBoundary(): void {
  const writerSource = readFileSync(
    path.join(repoRoot, "src/genes/Writer.hx"),
    "utf8"
  );
  ok(
    !/catch\s*\([^)]*:\s*Dynamic\b/.test(writerSource),
    "Writer unchanged-file comparison must infer its exception type"
  );

  const outputRoot = path.join(writerFixtureRoot, "out");
  rmSync(outputRoot, { recursive: true, force: true });

  const output = path.join(outputRoot, "nested/artifact.txt");
  runBufferedWriter(output, "first");
  strictEqual(readFileSync(output, "utf8"), "first");

  const oldTime = new Date("2000-01-01T00:00:00.000Z");
  utimesSync(output, oldTime, oldTime);
  const unchangedTime = statSync(output).mtimeMs;
  runBufferedWriter(output, "first");
  strictEqual(
    statSync(output).mtimeMs,
    unchangedTime,
    "identical buffered output was rewritten"
  );

  runBufferedWriter(output, "second");
  strictEqual(readFileSync(output, "utf8"), "second");
  ok(
    statSync(output).mtimeMs > unchangedTime,
    "changed buffered output did not replace the old file"
  );

  // POSIX permissions provide a real comparison-read failure while leaving
  // the owner able to open the file for writing. Running the same payload then
  // distinguishes fallback publication from an accidental unchanged return.
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    writeFileSync(output, "comparison-fallback", "utf8");
    utimesSync(output, oldTime, oldTime);
    chmodSync(output, 0o200);
    try {
      runBufferedWriter(output, "comparison-fallback");
    } finally {
      chmodSync(output, 0o600);
    }
    strictEqual(readFileSync(output, "utf8"), "comparison-fallback");
    ok(
      statSync(output).mtimeMs > oldTime.getTime(),
      "comparison read failure did not fall through to publication"
    );
  }

  const blockingParent = path.join(outputRoot, "not-a-directory");
  writeFileSync(blockingParent, "user-owned-parent", "utf8");
  const failedWrite = spawnSync("haxe", [
    "-cp",
    "src",
    "-cp",
    "tests/writer/src",
    "-D",
    "genes.unchanged_no_rewrite",
    "--run",
    "writerevidence.Main",
    path.join(blockingParent, "artifact.txt"),
    "must-fail"
  ], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  ok(failedWrite.status !== 0, "buffered writer swallowed a real write failure");
  strictEqual(readFileSync(blockingParent, "utf8"), "user-owned-parent");
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
assertBufferedWriterBoundary();

for (const profile of profiles) {
  const outputRoot = path.join(fixtureRoot, "out", profile.id);
  const userAsset = path.join(outputRoot, "assets/user-owned.txt");
  const unownedLegacyMap = profile.id === "ts"
    ? path.join(outputRoot, "StdTypes.ts.map")
    : null;
  const unownedLegacyMapContents = "user-owned-legacy-map\n";
  const initialDefines = ["output_transaction_include_stale"];

  // A historical compiler filename is not proof of compiler ownership. This
  // sentinel deliberately exists before the first manifest, so a successful
  // build must preserve it and must not claim it in the new manifest.
  if (unownedLegacyMap !== null) {
    mkdirSync(path.dirname(unownedLegacyMap), { recursive: true });
    writeFileSync(unownedLegacyMap, unownedLegacyMapContents, "utf8");
  }

  run(profile, initialDefines);
  if (unownedLegacyMap !== null) {
    strictEqual(
      readFileSync(unownedLegacyMap, "utf8"),
      unownedLegacyMapContents,
      "ts: first build deleted an unowned historical source-map filename"
    );
    ok(
      !manifestPaths(outputRoot).includes("StdTypes.ts.map"),
      "ts: manifest claimed the unowned historical source map"
    );

    // Model an older Genes build that did affirmatively own this path. Once
    // ownership appears in a recognized manifest, ordinary stale cleanup—not
    // the filename—must remove it on the next successful publication.
    writeFileSync(unownedLegacyMap, "genes-owned-legacy-map\n", "utf8");
    const previousOwned = [
      ...manifestPaths(outputRoot),
      "StdTypes.ts.map"
    ].sort((left, right) => left.localeCompare(right));
    writeFileSync(
      path.join(outputRoot, ".genes-output-index.manifest"),
      ["genes-output-manifest-v1", ...previousOwned, ""].join("\n"),
      "utf8"
    );
  }
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
  if (unownedLegacyMap !== null)
    ok(!existsSync(unownedLegacyMap),
      "ts: prior manifest-owned historical source map survived");
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

console.log("output-transaction:ok (writer boundary + TS/classic rollback + stale ownership)");
