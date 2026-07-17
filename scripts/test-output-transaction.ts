import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { Buffer } from "node:buffer";
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
  readonly entrypoint: string;
  readonly implementation: string;
  readonly stale: ReadonlyArray<string>;
};

type OwnerScopeBuild = {
  readonly main: string;
  readonly output: string;
  readonly implementation: string;
  readonly genesTs: boolean;
};

const profiles: ReadonlyArray<Profile> = [
  {
    id: "ts",
    hxml: "tests/output-transaction/build-ts.hxml",
    entrypoint: "index.ts",
    implementation: "transaction/MarkerA.ts",
    stale: ["transaction/StaleMarker.ts", "transaction/StaleMarker.ts.map"]
  },
  {
    id: "classic",
    hxml: "tests/output-transaction/build-classic.hxml",
    entrypoint: "index.js",
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

/** Builds one independently owned entrypoint into a shared output directory. */
function runOwnerScopeBuild(build: OwnerScopeBuild): void {
  execFileSync("haxe", [
    "-lib",
    "genes-ts",
    "-cp",
    "tests/output-transaction/owner-src",
    "--main",
    build.main,
    "-js",
    build.output,
    ...(build.genesTs ? ["-D", "genes.ts"] : ["-D", "dts"]),
    "-D",
    "genes.unchanged_no_rewrite",
    "-D",
    "no-deprecation-warnings",
    "-D",
    "js-es=6",
    "-dce",
    "full",
    "-debug"
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

type OutputManifest = {
  readonly absolutePath: string;
  readonly owner: string;
  readonly paths: ReadonlyArray<string>;
};

const manifestHeader = "genes-output-manifest-v2";
const ownerPrefix = "owner-base64:";

function serializeManifest(
  owner: string,
  paths: ReadonlyArray<string>
): string {
  const encodedOwner = Buffer.from(owner, "utf8").toString("base64");
  return [manifestHeader, `${ownerPrefix}${encodedOwner}`, ...paths, ""].join("\n");
}

/** Reads every v2 owner without treating preserved legacy manifests as live. */
function outputManifests(outputRoot: string): OutputManifest[] {
  if (!existsSync(outputRoot)) return [];
  const result: OutputManifest[] = [];
  for (const entry of readdirSync(outputRoot).sort()) {
    if (!entry.startsWith(".genes-output-") || !entry.endsWith(".manifest")) {
      continue;
    }
    const absolutePath = path.join(outputRoot, entry);
    const lines = readFileSync(absolutePath, "utf8")
      .replaceAll("\r", "")
      .split("\n");
    if (lines[0] !== manifestHeader) continue;
    ok(
      lines[1]?.startsWith(ownerPrefix),
      `Missing exact owner identity in ${absolutePath}`
    );
    const owner = Buffer.from(lines[1].slice(ownerPrefix.length), "base64")
      .toString("utf8");
    result.push({
      absolutePath,
      owner,
      paths: lines.slice(2).filter((line) => line.length > 0)
    });
  }
  return result;
}

function outputManifest(outputRoot: string, owner: string): OutputManifest {
  const matches = outputManifests(outputRoot)
    .filter((manifest) => manifest.owner === owner);
  strictEqual(
    matches.length,
    1,
    `Expected one output manifest for ${owner}, found ${matches.length}`
  );
  return matches[0];
}

function manifestPaths(outputRoot: string, owner: string): ReadonlyArray<string> {
  return outputManifest(outputRoot, owner).paths;
}

function assertNoTransactionDebris(outputRoot: string): void {
  for (const absolute of walkFiles(outputRoot)) {
    const relative = path.relative(outputRoot, absolute).replaceAll("\\", "/");
    ok(!relative.split("/").some((segment) =>
      segment.startsWith(".genes-output-") && segment.endsWith(".stage")),
      `Transaction staging file leaked: ${relative}`);
  }
  const direct = existsSync(outputRoot)
    ? readdirSync(outputRoot)
    : [];
  ok(!direct.some((entry) =>
    entry.startsWith(".genes-output-") && entry.endsWith(".stage")),
    "Transaction staging directory leaked");
}

/**
 * Proves transaction identity is based on the exact configured entrypoint.
 *
 * Why: a readable stem alone maps punctuation variants to one owner and drops
 * the output extension. The second build can then treat the first build's
 * modules as stale even though the entrypoints are independent.
 *
 * What/How: each pair shares a directory but has disjoint source modules. We
 * build A, B, and A again, checking that neither owner changes or removes the
 * other's implementation. The first pair also leaves a legacy v1 manifest in
 * the exact lossy location; without an exact owner record, it must remain
 * untouched rather than being consumed as deletion authority.
 */
function assertIndependentEntrypointOwners(): void {
  const scopeRoot = path.join(fixtureRoot, "out/owner-scopes");
  rmSync(scopeRoot, { recursive: true, force: true });
  mkdirSync(scopeRoot, { recursive: true });

  const legacyManifest = path.join(
    scopeRoot,
    ".genes-output-entry_one.manifest"
  );
  const legacyOwned = path.join(scopeRoot, "legacy-owned.txt");
  const legacyManifestContents = [
    "genes-output-manifest-v1",
    "legacy-owned.txt",
    ""
  ].join("\n");
  writeFileSync(legacyManifest, legacyManifestContents, "utf8");
  writeFileSync(legacyOwned, "ambiguous-legacy-owner\n", "utf8");

  const punctuationPair: ReadonlyArray<OwnerScopeBuild> = [
    {
      main: "transactionowners.OwnerAt",
      output: "tests/output-transaction/out/owner-scopes/entry@one.ts",
      implementation: "transactionowners/OwnerAt.ts",
      genesTs: true
    },
    {
      main: "transactionowners.OwnerHash",
      output: "tests/output-transaction/out/owner-scopes/entry#one.ts",
      implementation: "transactionowners/OwnerHash.ts",
      genesTs: true
    }
  ];

  runOwnerScopeBuild(punctuationPair[0]);
  strictEqual(readFileSync(legacyManifest, "utf8"), legacyManifestContents);
  strictEqual(readFileSync(legacyOwned, "utf8"), "ambiguous-legacy-owner\n");
  runOwnerScopeBuild(punctuationPair[1]);
  deepStrictEqual(
    outputManifests(scopeRoot).map((manifest) => manifest.owner).sort(),
    ["entry#one.ts", "entry@one.ts"],
    "Punctuation-distinct entrypoints did not receive exact owner manifests"
  );
  for (const build of punctuationPair) {
    ok(
      existsSync(path.join(scopeRoot, build.implementation)),
      `Punctuation-colliding owner lost ${build.implementation}`
    );
  }
  const punctuationPublished = captureTree(scopeRoot);
  runOwnerScopeBuild(punctuationPair[0]);
  for (const build of punctuationPair) {
    ok(
      existsSync(path.join(scopeRoot, build.implementation)),
      `Punctuation-colliding rebuild lost ${build.implementation}`
    );
  }
  deepStrictEqual(
    captureTree(scopeRoot),
    punctuationPublished,
    "Rebuilding one punctuation-colliding owner changed the shared tree"
  );

  const extensionRoot = path.join(fixtureRoot, "out/extension-scopes");
  rmSync(extensionRoot, { recursive: true, force: true });
  const extensionPair: ReadonlyArray<OwnerScopeBuild> = [
    {
      main: "transactionowners.OwnerAt",
      output: "tests/output-transaction/out/extension-scopes/index.ts",
      implementation: "transactionowners/OwnerAt.ts",
      genesTs: true
    },
    {
      main: "transactionowners.OwnerHash",
      output: "tests/output-transaction/out/extension-scopes/index.js",
      implementation: "transactionowners/OwnerHash.js",
      genesTs: false
    }
  ];
  runOwnerScopeBuild(extensionPair[0]);
  runOwnerScopeBuild(extensionPair[1]);
  deepStrictEqual(
    outputManifests(extensionRoot).map((manifest) => manifest.owner).sort(),
    ["index.js", "index.ts"],
    "Extension-distinct entrypoints did not receive exact owner manifests"
  );
  for (const build of extensionPair) {
    ok(
      existsSync(path.join(extensionRoot, build.implementation)),
      `Extension-distinct owner lost ${build.implementation}`
    );
  }
  const extensionPublished = captureTree(extensionRoot);
  runOwnerScopeBuild(extensionPair[0]);
  deepStrictEqual(
    captureTree(extensionRoot),
    extensionPublished,
    "Rebuilding one extension-distinct owner changed the shared tree"
  );
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
  const initialManifest = outputManifest(outputRoot, profile.entrypoint);
  const exactManifestContents = readFileSync(initialManifest.absolutePath, "utf8");

  // The digest makes accidental collisions impractical, while this exact
  // record catches corruption, copied manifests, and implementation mistakes
  // before any owned path can be treated as stale.
  writeFileSync(
    initialManifest.absolutePath,
    serializeManifest(`wrong-${profile.entrypoint}`, initialManifest.paths),
    "utf8"
  );
  const mismatchedTree = captureTree(outputRoot);
  expectFailure(
    profile,
    initialDefines,
    "Genes output manifest owner does not match"
  );
  deepStrictEqual(
    captureTree(outputRoot),
    mismatchedTree,
    `${profile.id}: owner mismatch changed the prior tree`
  );
  writeFileSync(initialManifest.absolutePath, exactManifestContents, "utf8");

  if (unownedLegacyMap !== null) {
    strictEqual(
      readFileSync(unownedLegacyMap, "utf8"),
      unownedLegacyMapContents,
      "ts: first build deleted an unowned historical source-map filename"
    );
    ok(
      !manifestPaths(outputRoot, profile.entrypoint).includes("StdTypes.ts.map"),
      "ts: manifest claimed the unowned historical source map"
    );

    // Model an older Genes build that did affirmatively own this path. Once
    // ownership appears in a recognized manifest, ordinary stale cleanup—not
    // the filename—must remove it on the next successful publication.
    writeFileSync(unownedLegacyMap, "genes-owned-legacy-map\n", "utf8");
    const previousOwned = [
      ...manifestPaths(outputRoot, profile.entrypoint),
      "StdTypes.ts.map"
    ].sort((left, right) => left.localeCompare(right));
    writeFileSync(
      outputManifest(outputRoot, profile.entrypoint).absolutePath,
      serializeManifest(profile.entrypoint, previousOwned),
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
  const owned = manifestPaths(outputRoot, profile.entrypoint);
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

assertIndependentEntrypointOwners();

console.log("output-transaction:ok (exact owners + writer boundary + TS/classic rollback + stale ownership)");
