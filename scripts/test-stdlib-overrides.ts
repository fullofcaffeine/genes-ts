import {
  deepStrictEqual,
  match,
  ok,
  strictEqual,
  throws
} from "node:assert";
import {
  execFileSync,
  spawnSync,
  type SpawnSyncReturns
} from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import {
  OwnedHaxeCompilerServer,
  selectedHaxeCompiler
} from "./compiler-server-lifecycle.js";
import {
  runGeneratedTypeScriptMatrix,
  toolchains
} from "./toolchains.js";

type OverrideEdit = {
  readonly from: string;
  readonly to: string;
  readonly count: number;
  readonly reason: string;
};

type StdlibOverride = {
  readonly module: string;
  readonly platform: string;
  readonly localPath: string;
  readonly haxeVersion: string;
  readonly haxeRepository: string;
  readonly haxeRevision: string;
  readonly upstreamPath: string;
  readonly upstreamSha256: string;
  readonly formatterVersion: string;
  readonly canonicalUpstreamSha256: string;
  readonly overrideSha256: string;
  readonly edits: ReadonlyArray<OverrideEdit>;
};

type OverrideManifest = {
  readonly schemaVersion: number;
  readonly overrides: ReadonlyArray<StdlibOverride>;
};

type HaxeSourceContract = {
  readonly repository: string;
  readonly version: string;
  readonly revision: string;
};

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, "../..");
const fixtureRoot = path.join(repoRoot, "tests/stdlib-overrides");
const fixtureSource = path.join(fixtureRoot, "src");
const outputRoot = path.join(fixtureRoot, "out");
const expectedTranscript = "000f107f80ff";
const expectedFormatterVersion = "1.18.0";

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function slash(value: string): string {
  return value.split(path.sep).join("/");
}

function occurrences(source: string, needle: string): number {
  ok(needle.length > 0, "An override edit cannot match an empty string");
  return source.split(needle).length - 1;
}

function replaceExactly(
  source: string,
  from: string,
  to: string,
  expectedCount: number,
  label: string
): string {
  strictEqual(
    occurrences(source, from),
    expectedCount,
    `${label} must occur exactly ${expectedCount} time(s)`
  );
  return source.split(from).join(to);
}

function assertHex(value: string, label: string, length: number): void {
  match(value, new RegExp(`^[0-9a-f]{${length}}$`), label);
}

function readManifest(): OverrideManifest {
  const manifest = JSON.parse(
    readFileSync(
      path.join(repoRoot, "config/stdlib-overrides.json"),
      "utf8"
    )
  ) as OverrideManifest;
  strictEqual(manifest.schemaVersion, 1);
  ok(
    Array.isArray(manifest.overrides) && manifest.overrides.length > 0,
    "The stdlib override manifest must contain at least one reviewed entry"
  );
  return manifest;
}

function readHaxeSourceContract(): HaxeSourceContract {
  const portableManifest = JSON.parse(
    readFileSync(
      path.join(repoRoot, "tests/portable-haxe-smoke/manifest.json"),
      "utf8"
    )
  ) as { readonly haxe: HaxeSourceContract };
  return portableManifest.haxe;
}

function assertManifestEntry(
  entry: StdlibOverride,
  sourceContract: HaxeSourceContract
): void {
  for (const [label, value] of Object.entries({
    module: entry.module,
    platform: entry.platform,
    localPath: entry.localPath,
    haxeVersion: entry.haxeVersion,
    haxeRepository: entry.haxeRepository,
    haxeRevision: entry.haxeRevision,
    upstreamPath: entry.upstreamPath,
    upstreamSha256: entry.upstreamSha256,
    formatterVersion: entry.formatterVersion,
    canonicalUpstreamSha256: entry.canonicalUpstreamSha256,
    overrideSha256: entry.overrideSha256
  })) {
    ok(
      typeof value === "string" && value.length > 0,
      `${entry.module}.${label} must be a non-empty string`
    );
  }
  strictEqual(
    entry.platform,
    "js",
    `${entry.module} overlays must target Haxe's JavaScript platform`
  );
  strictEqual(
    entry.localPath,
    `src/${entry.module.replaceAll(".", "/")}.${entry.platform}.hx`,
    `${entry.module} must use Haxe's platform-specific module filename`
  );
  strictEqual(
    entry.haxeVersion,
    sourceContract.version,
    `${entry.module} must track the authenticated Haxe source contract`
  );
  strictEqual(
    entry.haxeVersion,
    toolchains.haxe.stable,
    `${entry.module} must track the stable Haxe toolchain`
  );
  strictEqual(
    entry.haxeRepository,
    sourceContract.repository,
    `${entry.module} must use the authenticated Haxe source repository`
  );
  strictEqual(
    entry.haxeRevision,
    sourceContract.revision,
    `${entry.module} must use the authenticated Haxe source revision`
  );
  strictEqual(
    entry.formatterVersion,
    expectedFormatterVersion,
    `${entry.module} must use Genes' pinned Haxe formatter`
  );
  assertHex(entry.haxeRevision, `${entry.module}.haxeRevision`, 40);
  assertHex(entry.upstreamSha256, `${entry.module}.upstreamSha256`, 64);
  assertHex(
    entry.canonicalUpstreamSha256,
    `${entry.module}.canonicalUpstreamSha256`,
    64
  );
  assertHex(entry.overrideSha256, `${entry.module}.overrideSha256`, 64);
  ok(
    entry.upstreamPath.startsWith("std/js/_std/")
      && !entry.upstreamPath.split("/").includes(".."),
    `${entry.module}.upstreamPath must name a JavaScript stdlib module`
  );
  ok(entry.edits.length > 0, `${entry.module} must declare a reviewed edit`);
  for (const [index, edit] of entry.edits.entries()) {
    ok(edit.from.length > 0, `${entry.module}.edits[${index}].from is empty`);
    ok(edit.to.length > 0, `${entry.module}.edits[${index}].to is empty`);
    ok(
      Number.isInteger(edit.count) && edit.count > 0,
      `${entry.module}.edits[${index}].count must be a positive integer`
    );
    ok(
      edit.reason.length >= 40,
      `${entry.module}.edits[${index}] needs a useful semantic reason`
    );
  }
}

function listJavaScriptOverlays(root: string): string[] {
  const paths: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".js.hx")) {
        paths.push(slash(path.relative(repoRoot, absolute)));
      }
    }
  }
  visit(root);
  return paths.sort();
}

function assertOverlayInventory(
  registeredPaths: ReadonlyArray<string>,
  discoveredPaths: ReadonlyArray<string>
): void {
  deepStrictEqual(
    [...registeredPaths].sort(),
    [...discoveredPaths].sort(),
    "Every src/**/*.js.hx overlay must have exactly one manifest entry"
  );
}

function gitText(repository: string, args: ReadonlyArray<string>): string {
  return execFileSync("git", ["-C", repository, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function hasRevision(repository: string, revision: string): boolean {
  if (!existsSync(repository)) return false;
  const result = spawnSync(
    "git",
    ["-C", repository, "cat-file", "-e", `${revision}^{commit}`],
    { cwd: repoRoot, stdio: "ignore" }
  );
  return result.status === 0;
}

/**
 * Returns a Git repository that contains the exact reviewed Haxe commit.
 *
 * A nearby or explicitly supplied clone is reused when possible. Otherwise
 * the public repository is fetched into the ignored source cache. Reading the
 * stdlib from this object database authenticates the manifest revision; the
 * installed Haxe distribution is compared with those bytes separately.
 */
function authenticatedHaxeRepository(
  sourceContract: HaxeSourceContract
): string {
  const explicit = process.env.GENES_HAXE_SOURCE_REPOSITORY;
  const nearby = path.resolve(repoRoot, "../haxe");
  for (const candidate of [explicit, nearby]) {
    if (
      candidate !== undefined
      && hasRevision(candidate, sourceContract.revision)
    ) {
      strictEqual(
        gitText(candidate, [
          "rev-parse",
          `${sourceContract.revision}^{commit}`
        ]),
        sourceContract.revision,
        "The reused Haxe repository must resolve the exact reviewed commit"
      );
      return candidate;
    }
  }

  const cache = path.join(
    repoRoot,
    ".cache",
    "stdlib-overrides",
    `haxe-${sourceContract.revision}`
  );
  if (!existsSync(path.join(cache, ".git"))) {
    rmSync(cache, { recursive: true, force: true });
    mkdirSync(path.dirname(cache), { recursive: true });
    execFileSync("git", ["init", "--quiet", cache], {
      cwd: repoRoot,
      stdio: "pipe"
    });
    execFileSync(
      "git",
      ["-C", cache, "remote", "add", "origin", sourceContract.repository],
      { cwd: repoRoot, stdio: "pipe" }
    );
  }
  strictEqual(
    gitText(cache, ["remote", "get-url", "origin"]),
    sourceContract.repository,
    "The cached Haxe source remote must match the manifest"
  );
  if (!hasRevision(cache, sourceContract.revision)) {
    execFileSync(
      "git",
      [
        "-C",
        cache,
        "fetch",
        "--quiet",
        "--depth=1",
        "origin",
        sourceContract.revision
      ],
      { cwd: repoRoot, stdio: "pipe" }
    );
  }
  strictEqual(
    gitText(cache, ["rev-parse", `${sourceContract.revision}^{commit}`]),
    sourceContract.revision,
    "Fetched Haxe source must resolve the exact reviewed commit"
  );
  return cache;
}

function revisionFile(
  repository: string,
  revision: string,
  relativePath: string
): Buffer {
  return execFileSync(
    "git",
    ["-C", repository, "show", `${revision}:${relativePath}`],
    {
      cwd: repoRoot,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
}

function selectedFormatterVersion(): string {
  const result = runResult("haxelib", ["list", "formatter"]);
  assertSuccess(result, "Haxe formatter inventory");
  const selected = result.stdout.match(/formatter:.*\[([^\]]+)\]/)?.[1];
  ok(selected !== undefined, "One active Haxe formatter version is required");
  return selected;
}

function resultText(result: SpawnSyncReturns<string>): string {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function runResult(
  command: string,
  args: ReadonlyArray<string>
): SpawnSyncReturns<string> {
  const result = spawnSync(command, [...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (result.error !== undefined) throw result.error;
  return result;
}

function assertSuccess(
  result: SpawnSyncReturns<string>,
  label: string
): void {
  strictEqual(
    result.status,
    0,
    `${label} failed\n${resultText(result)}`
  );
}

function run(command: string, args: ReadonlyArray<string>): void {
  execFileSync(command, [...args], {
    cwd: repoRoot,
    stdio: "inherit"
  });
}

function readOutput(relativePath: string): string {
  return readFileSync(path.join(fixtureRoot, relativePath), "utf8");
}

function transcript(relativePath: string): string {
  return execFileSync(
    process.execPath,
    [path.join(fixtureRoot, relativePath)],
    { cwd: repoRoot, encoding: "utf8" }
  ).trim();
}

function sourceLine(source: string, needle: string): number {
  const offset = source.indexOf(needle);
  ok(offset !== -1, `Source contains ${needle}`);
  return source.slice(0, offset).split("\n").length;
}

function generatedPoint(
  source: string,
  needle: string
): { line: number; column: number } {
  const offset = source.indexOf(needle);
  ok(offset !== -1, `Generated source contains ${needle}`);
  const lines = source.slice(0, offset).split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)?.length ?? 0
  };
}

function genesArguments(
  output: string,
  profile: "typescript" | "classic",
  overrideRoot?: string,
  verbose = false
): string[] {
  return [
    ...(verbose ? ["-v"] : []),
    "-lib", "genes-ts",
    "-cp", fixtureSource,
    ...(overrideRoot === undefined ? [] : ["-cp", overrideRoot]),
    "--main", "stdliboverrides.Main",
    "-js", output,
    "-D", "no-deprecation-warnings",
    "-D", "js-es=6",
    "-dce", "full",
    "-debug",
    ...(profile === "typescript" ? ["-D", "genes.ts"] : ["-D", "dts"])
  ];
}

function assertBytesTypeScript(source: string): void {
  ok(
    source.includes("const chars: number[] = [];"),
    "Bytes.toHex keeps its integer lookup-table contract"
  );
  strictEqual(
    source.match(
      /Register\.unsafeCast<number>\(HxOverrides\.cca\(str, i\)\)/g
    )?.length,
    1,
    "the ordinary Null<Int> to Int push boundary receives one identity bridge"
  );
  strictEqual(
    source.match(/String\.fromCodePoint\(chars\[[^\]]+\]!\)/g)?.length,
    2,
    "the two concrete array reads use native TypeScript presence assertions"
  );
  ok(
    !source.includes("String.fromCodePoint(Register.unsafeCast"),
    "Genes does not infer a destination type inside raw syntax"
  );
}

const compiler = selectedHaxeCompiler(repoRoot);
strictEqual(
  compiler.version,
  toolchains.haxe.stable,
  "The active Haxe compiler must match the stable toolchain"
);
const standardLibraryRoot = process.env.HAXE_STD_PATH === undefined
  ? path.join(path.dirname(compiler.binary), "std")
  : path.resolve(process.env.HAXE_STD_PATH);
const haxeDistributionRoot = path.dirname(standardLibraryRoot);
const manifest = readManifest();
const sourceContract = readHaxeSourceContract();
const sourceRepository = authenticatedHaxeRepository(sourceContract);
strictEqual(
  selectedFormatterVersion(),
  expectedFormatterVersion,
  "The active Haxe formatter must match the reviewed formatter identity"
);
const identities = new Set<string>();
const localPaths = new Set<string>();
const discoveredOverlays = listJavaScriptOverlays(
  path.join(repoRoot, "src")
);

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

try {
  for (const entry of manifest.overrides) {
    assertManifestEntry(entry, sourceContract);
    const identity = `${entry.platform}:${entry.module}`;
    ok(!identities.has(identity), `Duplicate stdlib override: ${identity}`);
    ok(
      !localPaths.has(entry.localPath),
      `Duplicate stdlib override path: ${entry.localPath}`
    );
    identities.add(identity);
    localPaths.add(entry.localPath);

    const upstream = path.join(haxeDistributionRoot, entry.upstreamPath);
    const local = path.join(repoRoot, entry.localPath);
    const upstreamBytes = readFileSync(upstream);
    const reviewedUpstreamBytes = revisionFile(
      sourceRepository,
      entry.haxeRevision,
      entry.upstreamPath
    );
    const localBytes = readFileSync(local);
    strictEqual(
      sha256(reviewedUpstreamBytes),
      entry.upstreamSha256,
      `${entry.module} source at the reviewed Haxe revision changed identity`
    );
    deepStrictEqual(
      upstreamBytes,
      reviewedUpstreamBytes,
      `${entry.module} in the active Haxe distribution must match the reviewed revision`
    );
    strictEqual(
      sha256(localBytes),
      entry.overrideSha256,
      `${entry.module} override drifted without a manifest update`
    );

    const formattedUpstream = path.join(
      outputRoot,
      "canonical",
      `${entry.module.replaceAll(".", "-")}.${entry.platform}.hx`
    );
    mkdirSync(path.dirname(formattedUpstream), { recursive: true });
    copyFileSync(upstream, formattedUpstream);
    execFileSync(
      "haxelib",
      ["run", "formatter", "-s", formattedUpstream],
      { cwd: repoRoot, stdio: "pipe" }
    );
    const canonical = readFileSync(formattedUpstream, "utf8");
    strictEqual(
      sha256(canonical),
      entry.canonicalUpstreamSha256,
      `${entry.module} formatter-canonical upstream source drifted`
    );

    let expectedOverride = canonical;
    for (const [index, edit] of entry.edits.entries()) {
      expectedOverride = replaceExactly(
        expectedOverride,
        edit.from,
        edit.to,
        edit.count,
        `${entry.module}.edits[${index}].from`
      );
    }
    strictEqual(
      readFileSync(local, "utf8"),
      expectedOverride,
      `${entry.module} must differ from canonical upstream only by declared edits`
    );
  }

  assertOverlayInventory([...localPaths], discoveredOverlays);
  const mutationControl = manifest.overrides[0];
  ok(mutationControl !== undefined, "A manifest entry is required");
  throws(
    () => assertManifestEntry(
      { ...mutationControl, haxeRevision: "0".repeat(40) },
      sourceContract
    ),
    /authenticated Haxe source revision/,
    "a syntactically valid but unauthenticated Haxe revision must fail"
  );
  throws(
    () => assertManifestEntry(
      { ...mutationControl, formatterVersion: "0.0.0" },
      sourceContract
    ),
    /pinned Haxe formatter/,
    "a bogus formatter label must fail"
  );
  throws(
    () => assertManifestEntry(
      { ...mutationControl, platform: "ts" },
      sourceContract
    ),
    /JavaScript platform/,
    "a non-JavaScript platform label must fail"
  );
  throws(
    () => assertOverlayInventory(
      [...localPaths],
      [...discoveredOverlays, "src/String.js.hx"]
    ),
    /manifest entry/,
    "an unregistered top-level JavaScript overlay must fail"
  );

  const bytesEntry = manifest.overrides.find(
    (entry) => entry.module === "haxe.io.Bytes" && entry.platform === "js"
  );
  ok(bytesEntry !== undefined, "The Bytes JS override is registered");

  const positive = runResult(
    "haxe",
    ["-v", "tests/stdlib-overrides/build-ts.hxml"]
  );
  assertSuccess(positive, "TypeScript stdlib-overlay build");
  match(
    slash(resultText(positive)),
    /Parsed (?:.*\/)?src\/haxe\/io\/Bytes\.js\.hx/,
    "a source checkout automatically selects Bytes.js.hx"
  );
  runGeneratedTypeScriptMatrix(
    "tests/stdlib-overrides/tsconfig.generated.json"
  );
  run("haxe", ["tests/stdlib-overrides/build-classic.hxml"]);
  run("haxe", ["tests/stdlib-overrides/build-standard.hxml"]);

  const bytesTs = readOutput("out/ts/src-gen/haxe/io/Bytes.ts");
  assertBytesTypeScript(bytesTs);

  const bytesSource = readFileSync(
    path.join(repoRoot, bytesEntry.localPath),
    "utf8"
  );
  const bytesMap = new SourceMapConsumer(
    JSON.parse(
      readOutput("out/ts/src-gen/haxe/io/Bytes.ts.map")
    ) as RawSourceMap
  );
  const mappedPush = bytesMap.originalPositionFor(
    generatedPoint(
      bytesTs,
      "Register.unsafeCast<number>(HxOverrides.cca(str, i))"
    )
  );
  ok(
    mappedPush.source?.endsWith("src/haxe/io/Bytes.js.hx"),
    "the boundary maps to the reviewed Genes stdlib overlay"
  );
  strictEqual(
    mappedPush.line,
    sourceLine(bytesSource, "chars.push(str.charCodeAt(i));"),
    "the boundary maps to the original lookup-table insertion"
  );

  const controlRoot = path.join(outputRoot, "upstream-control");
  const controlFile = path.join(controlRoot, "haxe/io/Bytes.js.hx");
  mkdirSync(path.dirname(controlFile), { recursive: true });
  const upstream = path.join(haxeDistributionRoot, bytesEntry.upstreamPath);
  copyFileSync(upstream, controlFile);

  const controlTsOutput = path.join(
    outputRoot,
    "control-ts/src-gen/index.ts"
  );
  const controlTsBuild = runResult(
    "haxe",
    genesArguments(
      controlTsOutput,
      "typescript",
      controlRoot,
      true
    )
  );
  assertSuccess(controlTsBuild, "Unannotated upstream control build");
  match(
    slash(resultText(controlTsBuild)),
    /Parsed .*tests\/stdlib-overrides\/out\/upstream-control\/haxe\/io\/Bytes\.js\.hx/,
    "the fail-closed control selects its exact unannotated module"
  );

  const controlBytesTs = readOutput(
    "out/control-ts/src-gen/haxe/io/Bytes.ts"
  );
  ok(
    controlBytesTs.includes("const chars: (number | null)[] = [];"),
    "unannotated upstream Haxe retains its nullable lookup-table type"
  );
  strictEqual(
    controlBytesTs.match(
      /String\.fromCodePoint\(\(chars\[[^\]]+\] \?\? null\)\)/g
    )?.length,
    2,
    "the raw placeholders retain nullable source projection"
  );
  ok(
    !controlBytesTs.includes("unsafeCast<number>"),
    "raw template text does not authorize an invented Int destination"
  );

  const controlCheck = runResult(process.execPath, [
    path.join(repoRoot, "scripts/run-typescript.mjs"),
    "legacyFloor",
    "--target", "ES2022",
    "--module", "NodeNext",
    "--moduleResolution", "NodeNext",
    "--strict",
    "--exactOptionalPropertyTypes",
    "--noUncheckedIndexedAccess",
    "--types", "node",
    "--verbatimModuleSyntax",
    "--skipLibCheck", "false",
    "--noEmit",
    controlTsOutput
  ]);
  strictEqual(
    controlCheck.status,
    1,
    "the unannotated control remains a strict-TypeScript failure"
  );
  strictEqual(
    resultText(controlCheck).match(/error TS2345:/g)?.length,
    2,
    "the control retains the two honest nullable-to-number diagnostics"
  );

  const controlClassicOutput = path.join(
    outputRoot,
    "control-classic/index.js"
  );
  assertSuccess(
    runResult(
      "haxe",
      genesArguments(controlClassicOutput, "classic", controlRoot)
    ),
    "Classic unannotated control build"
  );
  strictEqual(
    readOutput("out/classic/haxe/io/Bytes.js"),
    readOutput("out/control-classic/haxe/io/Bytes.js"),
    "the Haxe type annotation does not alter classic JavaScript"
  );

  deepStrictEqual(
    [
      transcript("out/ts/dist/index.js"),
      transcript("out/classic/index.js"),
      transcript("out/control-classic/index.js"),
      transcript("out/standard/index.cjs")
    ],
    [
      expectedTranscript,
      expectedTranscript,
      expectedTranscript,
      expectedTranscript
    ],
    "Genes TS, classic, unannotated classic, and standard Haxe agree at runtime"
  );

  const server = await OwnedHaxeCompilerServer.start(repoRoot, compiler);
  server.installSignalCleanup();
  try {
    const warmTsOne = path.join(outputRoot, "warm-ts-one/src-gen/index.ts");
    const warmTsResult = await server.compile(
      genesArguments(warmTsOne, "typescript"),
      "Warm stdlib-overlay TypeScript build",
      60_000
    );
    strictEqual(
      warmTsResult.code,
      0,
      `Warm TypeScript build failed\n${warmTsResult.stdout}`
        + `\n${warmTsResult.stderr}\n${server.logs}`
    );
    const warmTsBytes = readFileSync(
      path.join(outputRoot, "warm-ts-one/src-gen/haxe/io/Bytes.ts"),
      "utf8"
    );
    strictEqual(
      warmTsBytes,
      bytesTs,
      "warm and cold TypeScript emit the same Bytes module"
    );

    const warmClassic = path.join(outputRoot, "warm-classic/index.js");
    const warmClassicResult = await server.compile(
      genesArguments(warmClassic, "classic"),
      "Warm stdlib-overlay classic build",
      60_000
    );
    strictEqual(
      warmClassicResult.code,
      0,
      `Warm classic build failed\n${warmClassicResult.stdout}`
        + `\n${warmClassicResult.stderr}\n${server.logs}`
    );
    strictEqual(
      readOutput("out/warm-classic/haxe/io/Bytes.js"),
      readOutput("out/classic/haxe/io/Bytes.js"),
      "warm and cold classic output remain identical"
    );

    const warmTsTwo = path.join(outputRoot, "warm-ts-two/src-gen/index.ts");
    const warmTsAgain = await server.compile(
      genesArguments(warmTsTwo, "typescript"),
      "Repeated warm stdlib-overlay TypeScript build",
      60_000
    );
    strictEqual(
      warmTsAgain.code,
      0,
      `Repeated warm TypeScript build failed\n${warmTsAgain.stdout}`
        + `\n${warmTsAgain.stderr}\n${server.logs}`
    );
    strictEqual(
      readFileSync(
        path.join(outputRoot, "warm-ts-two/src-gen/haxe/io/Bytes.ts"),
        "utf8"
      ),
      bytesTs,
      "a classic request does not contaminate the next warm TypeScript request"
    );
  } finally {
    await server.stop();
  }

  process.stdout.write(
    "stdlib-overrides:ok "
      + "(manifest + source selection + TS5/6/7 + fail-closed control "
      + "+ classic parity + runtime + maps + compiler server)\n"
  );
} finally {
  // Generated evidence remains under the fixture's ignored out/ directory for
  // local inspection. Every run removes that tree before rebuilding it.
}
