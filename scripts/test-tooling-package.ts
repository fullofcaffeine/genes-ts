import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const toolingRoot = path.join(repoRoot, "tooling");
const reviewedInventoryPath = path.join(
  repoRoot,
  "config",
  "tooling-package-files.json"
);

interface PackedFile {
  readonly path: string;
  readonly size: number;
  readonly mode: number;
}

interface PackResult {
  readonly filename: string;
  readonly integrity: string;
  readonly name: string;
  readonly version: string;
  readonly files: readonly PackedFile[];
}

interface TarballEntry {
  readonly mode?: number;
  readonly path: string;
  readonly size: number;
  readonly type: string;
}

interface TarballListOptions {
  readonly file: string;
  readonly onReadEntry: (entry: TarballEntry) => void;
  readonly strict: boolean;
  readonly sync: boolean;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Loads the pinned tar parser through a narrow checked boundary.
 *
 * `tar` 7 supports this repository's Node 22+ runtime, but its declarations
 * also mention Node's newer Zstandard APIs, which are absent from the
 * deliberately older `@types/node` 20 compatibility surface used to compile
 * every repository script. Importing those declarations would therefore
 * weaken or globally upgrade an unrelated contract. We validate the one
 * function used here and expose only the small synchronous-listing shape this
 * verifier needs.
 */
function loadTarballList(): (options: TarballListOptions) => void {
  const loaded: unknown = createRequire(import.meta.url)("tar");
  assert(
    isRecord(loaded) && typeof loaded.list === "function",
    "pinned tar package does not expose list()"
  );
  const list = loaded.list;
  return (options) => {
    Reflect.apply(list, loaded, [options]);
  };
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  context: string
): string {
  const field = value[key];
  assert(typeof field === "string", `${context}.${key} must be a string`);
  return field;
}

function requiredNumber(
  value: Record<string, unknown>,
  key: string,
  context: string
): number {
  const field = value[key];
  assert(typeof field === "number", `${context}.${key} must be a number`);
  return field;
}

function parsePackedFile(value: unknown, index: number): PackedFile {
  assert(isRecord(value), `npm pack files[${index}] must be an object`);
  return {
    path: requiredString(value, "path", `npm pack files[${index}]`),
    size: requiredNumber(value, "size", `npm pack files[${index}]`),
    mode: requiredNumber(value, "mode", `npm pack files[${index}]`),
  };
}

function parsePackResult(stdout: string): PackResult {
  const decoded: unknown = JSON.parse(stdout);
  assert(
    Array.isArray(decoded) && decoded.length === 1,
    "npm pack --json must return exactly one package result"
  );
  const value = decoded[0];
  assert(isRecord(value), "npm pack result must be an object");
  const files = value.files;
  assert(Array.isArray(files), "npm pack result.files must be an array");
  return {
    filename: requiredString(value, "filename", "npm pack result"),
    integrity: requiredString(value, "integrity", "npm pack result"),
    name: requiredString(value, "name", "npm pack result"),
    version: requiredString(value, "version", "npm pack result"),
    files: files.map(parsePackedFile),
  };
}

function parseReviewedInventory(): readonly string[] {
  const decoded: unknown = JSON.parse(
    readFileSync(reviewedInventoryPath, "utf8")
  );
  assert(
    Array.isArray(decoded) && decoded.every((value) => typeof value === "string"),
    "config/tooling-package-files.json must be an array of file paths"
  );
  const paths = decoded as string[];
  assert(paths.length > 0, "reviewed tooling package inventory must not be empty");
  assert(
    new Set(paths).size === paths.length,
    "reviewed tooling package inventory contains a duplicate path"
  );
  assert(
    [...paths].sort().join("\n") === paths.join("\n"),
    "reviewed tooling package inventory must stay sorted"
  );
  return paths;
}

/**
 * Reads the candidate archive itself instead of trusting npm's adjacent JSON
 * report.
 *
 * The pack report is useful release evidence, but it is not the package users
 * install. Reading both surfaces prevents a swapped or stale report from
 * authorizing different tarball bytes. npm archives every package file below
 * `package/`; links, directories, duplicate paths, and other entry kinds are
 * rejected because this package contract consists only of immutable data
 * files.
 */
function readTarballInventory(tarball: string): readonly PackedFile[] {
  const files: PackedFile[] = [];
  loadTarballList()({
    file: tarball,
    sync: true,
    strict: true,
    onReadEntry: (entry) => {
      assert(entry.type === "File", `tarball contains ${entry.type}: ${entry.path}`);
      assert(
        entry.path.startsWith("package/"),
        `tarball entry is outside the npm package root: ${entry.path}`
      );
      const relativePath = entry.path.slice("package/".length);
      assert(
        relativePath.length > 0 && !relativePath.startsWith("/"),
        `tarball entry has an invalid package path: ${entry.path}`
      );
      assert(
        entry.mode !== undefined,
        `tarball entry has no file mode: ${entry.path}`
      );
      files.push({
        path: relativePath,
        size: entry.size,
        mode: entry.mode,
      });
    },
  });
  assert(files.length > 0, "candidate tarball contains no package files");
  assert(
    new Set(files.map((file) => file.path)).size === files.length,
    "candidate tarball contains a duplicate file path"
  );
  return files;
}

function comparePackedFiles(
  archiveFiles: readonly PackedFile[],
  reportedFiles: readonly PackedFile[]
): void {
  const normalize = (files: readonly PackedFile[]): string =>
    [...files]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => `${file.path}\t${file.size}\t${file.mode}`)
      .join("\n");
  assert(
    normalize(archiveFiles) === normalize(reportedFiles),
    "candidate tarball entries differ from npm pack metadata"
  );
}

function expectFailure(action: () => void, message: string): void {
  let failed = false;
  try {
    action();
  } catch {
    failed = true;
  }
  assert(failed, message);
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  label: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `${label} failed (${String(result.status)})\n${result.stdout}${result.stderr}`
    );
  }
  return result.stdout;
}

function verifyReleaseEvidence(
  packed: { result: PackResult; tarball: string },
  tempRoot: string
): void {
  const packJson = path.join(tempRoot, "pack.json");
  writeFileSync(packJson, `${JSON.stringify([packed.result], null, 2)}\n`, "utf8");
  const evidenceScript = path.join(
    __dirname,
    "create-tooling-release-evidence.js"
  );
  const first = path.join(tempRoot, "evidence-first");
  const second = path.join(tempRoot, "evidence-second");
  const env = {
    ...process.env,
    SOURCE_DATE_EPOCH: "1700000000",
    GENES_RELEASE_COMMIT: "1111111111111111111111111111111111111111",
  };
  for (const output of [first, second]) {
    run(
      process.execPath,
      [
        evidenceScript,
        "--tarball",
        packed.tarball,
        "--pack-json",
        packJson,
        "--output",
        output,
      ],
      repoRoot,
      "create tooling release evidence",
      env
    );
  }
  for (const filename of ["release-receipt.json", "sbom.spdx.json"]) {
    const firstBytes = readFileSync(path.join(first, filename));
    const secondBytes = readFileSync(path.join(second, filename));
    assert(
      firstBytes.equals(secondBytes),
      `${filename} is not deterministic for identical release inputs`
    );
  }
  const receipt = readJsonObject(
    path.join(first, "release-receipt.json"),
    "release receipt"
  );
  const receiptPackage = receipt.package;
  assert(isRecord(receiptPackage), "release receipt.package must be an object");
  assert(
    receiptPackage.name === packed.result.name &&
      receiptPackage.version === packed.result.version,
    "release receipt has the wrong package identity"
  );
  const spdx = readJsonObject(path.join(first, "sbom.spdx.json"), "SPDX SBOM");
  assert(spdx.spdxVersion === "SPDX-2.3", "release SBOM must use SPDX 2.3");
  assert(
    Array.isArray(spdx.packages) && spdx.packages.length === 1,
    "dependency-free tooling SBOM must describe exactly one package"
  );
  const spdxPackage = spdx.packages[0];
  assert(isRecord(spdxPackage), "release SBOM package must be an object");
  const externalRefs = spdxPackage.externalRefs;
  assert(
    Array.isArray(externalRefs) &&
      externalRefs.some(
        (reference) =>
          isRecord(reference) &&
          reference.referenceCategory === "PACKAGE-MANAGER" &&
          reference.referenceType === "purl" &&
          reference.referenceLocator ===
            `pkg:npm/%40genes-ts/tooling@${packed.result.version}`
      ),
    "release SBOM must use the canonical scoped npm Package URL"
  );
}

function readJsonObject(
  file: string,
  label: string
): Record<string, unknown> {
  const decoded: unknown = JSON.parse(readFileSync(file, "utf8"));
  assert(isRecord(decoded), `${label} must be a JSON object`);
  return decoded;
}

function sha512Integrity(file: string): string {
  const digest = createHash("sha512").update(readFileSync(file)).digest("base64");
  return `sha512-${digest}`;
}

const protocolFiles = new Set([
  "artifact-transactions/v1/README.md",
  "artifact-transactions/v1/protocol.schema.json",
  "artifact-transactions/v1/vectors.json",
  "artifact-transactions/v1/vectors.schema.json",
  "development-session/v1/README.md",
  "development-session/v1/protocol.schema.json",
  "development-session/v1/vectors.json",
  "development-session/v1/vectors.schema.json",
  "haxe-wait-server/v1/README.md",
  "haxe-wait-server/v1/vectors.json",
  "haxe-wait-server/v1/vectors.schema.json",
  "watch-orchestration/v1/README.md",
  "watch-orchestration/v1/vectors.json",
  "watch-orchestration/v1/vectors.schema.json",
]);

const metadataFiles = new Set([
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "package.json",
]);

const expectedPublicExports = [
  ".",
  "./artifact-transactions/v1/protocol.schema.json",
  "./artifact-transactions/v1/vectors.json",
  "./artifact-transactions/v1/vectors.schema.json",
  "./artifacts",
  "./development-session/v1/protocol.schema.json",
  "./development-session/v1/vectors.json",
  "./development-session/v1/vectors.schema.json",
  "./haxe-server",
  "./haxe-wait-server/v1/vectors.json",
  "./haxe-wait-server/v1/vectors.schema.json",
  "./hxml",
  "./loop",
  "./session",
  "./watch",
  "./watch-orchestration/v1/vectors.json",
  "./watch-orchestration/v1/vectors.schema.json",
] as const;

function verifyInventory(result: PackResult): readonly string[] {
  assert(result.name === "@genes-ts/tooling", "packed package name changed");
  assert(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(result.version),
    "tooling version must be an explicit SemVer identity"
  );
  const paths = result.files.map((file) => file.path);
  const sorted = [...paths].sort();
  assert(
    new Set(paths).size === paths.length,
    "npm package file inventory contains a duplicate path"
  );
  for (const required of metadataFiles) {
    assert(paths.includes(required), `packed package is missing ${required}`);
  }
  for (const required of protocolFiles) {
    assert(paths.includes(required), `packed package is missing ${required}`);
  }
  for (const file of result.files) {
    assert(file.size >= 0, `packed file has invalid size: ${file.path}`);
    assert(file.mode === 0o644, `packed file must be read-only data: ${file.path}`);
  }
  const reviewedPaths = parseReviewedInventory();
  assert(
    sorted.join("\n") === reviewedPaths.join("\n"),
    "packed package file list differs from config/tooling-package-files.json"
  );
  const requiredEntrypoints = [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/artifacts/index.js",
    "dist/artifacts/index.d.ts",
    "dist/hxml/index.js",
    "dist/hxml/index.d.ts",
    "dist/watch/index.js",
    "dist/watch/index.d.ts",
    "dist/loop/index.js",
    "dist/loop/index.d.ts",
    "dist/haxe-server/index.js",
    "dist/haxe-server/index.d.ts",
    "dist/session/index.js",
    "dist/session/index.d.ts",
  ];
  for (const entrypoint of requiredEntrypoints) {
    assert(paths.includes(entrypoint), `packed package is missing ${entrypoint}`);
  }
  return sorted;
}

function verifyChangelogVersion(version: string): void {
  const changelog = readFileSync(
    path.join(toolingRoot, "CHANGELOG.md"),
    "utf8"
  );
  const releaseHeadings = [
    ...changelog.matchAll(
      /^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/gm
    ),
  ].map((match) => match[1]);
  assert(
    releaseHeadings.length > 0,
    "tooling/CHANGELOG.md must contain at least one SemVer release heading"
  );
  assert(
    releaseHeadings[0] === version,
    `tooling changelog starts at ${releaseHeadings[0]} instead of package version ${version}`
  );
  assert(
    new Set(releaseHeadings).size === releaseHeadings.length,
    "tooling changelog contains a duplicate release heading"
  );
}

function verifyPackageMetadata(): { name: string; version: string } {
  const packageJson = readJsonObject(
    path.join(toolingRoot, "package.json"),
    "tooling/package.json"
  );
  const name = requiredString(packageJson, "name", "tooling/package.json");
  const version = requiredString(
    packageJson,
    "version",
    "tooling/package.json"
  );
  assert(name === "@genes-ts/tooling", "tooling package name changed");
  assert(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version),
    "tooling package version must be an explicit SemVer identity"
  );
  verifyChangelogVersion(version);
  assert(
    packageJson.dependencies === undefined,
    "@genes-ts/tooling must remain dependency-free unless release policy is explicitly expanded"
  );
  const scripts = packageJson.scripts;
  assert(
    isRecord(scripts) &&
      scripts.build === "tsc6 -p tsconfig.json" &&
      scripts.prepare === "npm run build",
    "Git-source installation must build the tooling subpackage without repository-root scripts"
  );
  const devDependencies = packageJson.devDependencies;
  assert(
    isRecord(devDependencies) &&
      devDependencies["@types/node"] === "20.19.30" &&
      devDependencies.ajv === "8.20.0" &&
      devDependencies.typescript === "npm:@typescript/typescript6@6.0.2" &&
      Object.keys(devDependencies).length === 3,
    "Git-source build dependencies must stay exact and self-contained"
  );
  const repository = packageJson.repository;
  assert(
    isRecord(repository) &&
      repository.type === "git" &&
      repository.url ===
        "git+https://github.com/fullofcaffeine/genes-ts.git" &&
      repository.directory === "tooling",
    "tooling package repository metadata must exactly identify its public provenance source"
  );
  const exports = packageJson.exports;
  assert(isRecord(exports), "tooling/package.json.exports must be an object");
  const actualExports = Object.keys(exports).sort();
  assert(
    actualExports.join("\n") === [...expectedPublicExports].sort().join("\n"),
    "tooling public exports changed without extending the packed-consumer contract"
  );
  return { name, version };
}

function pack(destination: string): { result: PackResult; tarball: string } {
  const stdout = run(
    "npm",
    ["pack", "--json", "--pack-destination", destination],
    toolingRoot,
    "npm pack @genes-ts/tooling"
  );
  const result = parsePackResult(stdout);
  const tarball = path.join(destination, result.filename);
  assert(
    sha512Integrity(tarball) === result.integrity,
    "npm-reported integrity does not match packed tarball bytes"
  );
  verifyInventory(result);
  return { result, tarball };
}

function verifyCleanConsumer(tarball: string, tempRoot: string): void {
  const consumer = path.join(tempRoot, "consumer");
  const packageJson = {
    name: "genes-tooling-packed-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
  };
  mkdirSync(consumer, { recursive: true });
  writeFileSync(
    path.join(consumer, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(
    path.join(consumer, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        include: ["consumer.ts"],
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writeFileSync(
    path.join(consumer, "consumer.ts"),
    `import {
  DEVELOPMENT_SESSION_EVENT_PROTOCOL,
  publishArtifacts,
  type DevelopmentEvent,
  type PublicationPlan,
} from "@genes-ts/tooling";
import { recoverArtifacts } from "@genes-ts/tooling/artifacts";
import { inventoryHxml, type HxmlInventory } from "@genes-ts/tooling/hxml";
import { SerializedDirtyLoop } from "@genes-ts/tooling/loop";
import {
  OwnedHaxeWaitServer,
  reserveLoopbackEndpoint,
  type HaxeWaitEndpoint,
} from "@genes-ts/tooling/haxe-server";
import {
  watchReconciledInputs,
  type ReconciledWatchSession,
} from "@genes-ts/tooling/watch";
import type {
  DevelopmentSession,
  DevelopmentSnapshot,
  GenesDevelopmentOptions,
  JsonValue,
} from "@genes-ts/tooling/session";
import artifactProtocol from "@genes-ts/tooling/artifact-transactions/v1/protocol.schema.json" with { type: "json" };
import artifactVectors from "@genes-ts/tooling/artifact-transactions/v1/vectors.json" with { type: "json" };
import artifactVectorSchema from "@genes-ts/tooling/artifact-transactions/v1/vectors.schema.json" with { type: "json" };
import waitVectors from "@genes-ts/tooling/haxe-wait-server/v1/vectors.json" with { type: "json" };
import waitVectorSchema from "@genes-ts/tooling/haxe-wait-server/v1/vectors.schema.json" with { type: "json" };
import watchVectors from "@genes-ts/tooling/watch-orchestration/v1/vectors.json" with { type: "json" };
import watchVectorSchema from "@genes-ts/tooling/watch-orchestration/v1/vectors.schema.json" with { type: "json" };
import sessionProtocol from "@genes-ts/tooling/development-session/v1/protocol.schema.json" with { type: "json" };
import sessionVectors from "@genes-ts/tooling/development-session/v1/vectors.json" with { type: "json" };
import sessionVectorSchema from "@genes-ts/tooling/development-session/v1/vectors.schema.json" with { type: "json" };

const runtimeValues = [
  publishArtifacts,
  recoverArtifacts,
  inventoryHxml,
  SerializedDirtyLoop,
  OwnedHaxeWaitServer,
  reserveLoopbackEndpoint,
  watchReconciledInputs,
  artifactProtocol,
  artifactVectors,
  artifactVectorSchema,
  waitVectors,
  waitVectorSchema,
  watchVectors,
  watchVectorSchema,
  DEVELOPMENT_SESSION_EVENT_PROTOCOL,
  sessionProtocol,
  sessionVectors,
  sessionVectorSchema,
];
type Diagnostic = { readonly code: string; readonly details: readonly JsonValue[] };
const typeWitness:
  | PublicationPlan
  | HxmlInventory
  | HaxeWaitEndpoint
  | ReconciledWatchSession
  | DevelopmentEvent<Diagnostic>
  | DevelopmentSession<Diagnostic>
  | DevelopmentSnapshot<Diagnostic>
  | GenesDevelopmentOptions<Diagnostic>
  | undefined = undefined;
void runtimeValues;
void typeWitness;
`,
    "utf8"
  );
  writeFileSync(
    path.join(consumer, "runtime.mjs"),
    `import * as root from "@genes-ts/tooling";
import * as artifacts from "@genes-ts/tooling/artifacts";
import * as hxml from "@genes-ts/tooling/hxml";
import * as loop from "@genes-ts/tooling/loop";
import * as server from "@genes-ts/tooling/haxe-server";
import * as session from "@genes-ts/tooling/session";
import * as watch from "@genes-ts/tooling/watch";
import artifactProtocol from "@genes-ts/tooling/artifact-transactions/v1/protocol.schema.json" with { type: "json" };
import artifactVectors from "@genes-ts/tooling/artifact-transactions/v1/vectors.json" with { type: "json" };
import artifactVectorSchema from "@genes-ts/tooling/artifact-transactions/v1/vectors.schema.json" with { type: "json" };
import waitVectors from "@genes-ts/tooling/haxe-wait-server/v1/vectors.json" with { type: "json" };
import waitVectorSchema from "@genes-ts/tooling/haxe-wait-server/v1/vectors.schema.json" with { type: "json" };
import watchVectors from "@genes-ts/tooling/watch-orchestration/v1/vectors.json" with { type: "json" };
import watchVectorSchema from "@genes-ts/tooling/watch-orchestration/v1/vectors.schema.json" with { type: "json" };
import sessionProtocol from "@genes-ts/tooling/development-session/v1/protocol.schema.json" with { type: "json" };
import sessionVectors from "@genes-ts/tooling/development-session/v1/vectors.json" with { type: "json" };
import sessionVectorSchema from "@genes-ts/tooling/development-session/v1/vectors.schema.json" with { type: "json" };

const witnesses = [
  root.publishArtifacts,
  artifacts.recoverArtifacts,
  hxml.inventoryHxml,
  loop.SerializedDirtyLoop,
  server.OwnedHaxeWaitServer,
  server.reserveLoopbackEndpoint,
  watch.watchReconciledInputs,
  root.DEVELOPMENT_SESSION_EVENT_PROTOCOL,
  session.DEVELOPMENT_SESSION_EVENT_VERSION,
];
if (witnesses.slice(0, 7).some((value) => typeof value !== "function")) {
  throw new Error("a public tooling runtime export is missing");
}
if (
  root.DEVELOPMENT_SESSION_EVENT_PROTOCOL !==
    "genes.tooling.development-session-event" ||
  session.DEVELOPMENT_SESSION_EVENT_VERSION !== 1
) {
  throw new Error("the development-session protocol identity changed");
}
for (const vectors of [
  artifactProtocol,
  artifactVectors,
  artifactVectorSchema,
  waitVectors,
  waitVectorSchema,
  watchVectors,
  watchVectorSchema,
  sessionProtocol,
  sessionVectors,
  sessionVectorSchema,
]) {
  if (typeof vectors !== "object" || vectors === null) {
    throw new Error("a public tooling vector export is missing");
  }
}
console.log("tooling-packed-consumer:ok");
`,
    "utf8"
  );
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      tarball,
    ],
    consumer,
    "install packed @genes-ts/tooling"
  );
  const typescriptRunner = path.join(repoRoot, "scripts", "run-typescript.mjs");
  run(
    process.execPath,
    [typescriptRunner, "apiBridge", "-p", path.join(consumer, "tsconfig.json")],
    repoRoot,
    "typecheck packed consumer"
  );
  run(process.execPath, ["runtime.mjs"], consumer, "run packed consumer");
}

interface SuppliedPackage {
  readonly tarball: string;
  readonly packJson: string;
}

function parseSuppliedPackage(args: readonly string[]): SuppliedPackage | null {
  if (args.length === 0) return null;
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(
      key !== undefined &&
        value !== undefined &&
        (key === "--tarball" || key === "--pack-json") &&
        !values.has(key),
      "usage: test-tooling-package [--tarball <package.tgz> --pack-json <npm-pack.json>]"
    );
    values.set(key, value);
  }
  const tarball = values.get("--tarball");
  const packJson = values.get("--pack-json");
  assert(
    tarball !== undefined && packJson !== undefined,
    "--tarball and --pack-json must be supplied together"
  );
  return {
    tarball: path.resolve(tarball),
    packJson: path.resolve(packJson),
  };
}

function verifySuppliedPackage(
  supplied: SuppliedPackage,
  expected: { name: string; version: string },
  tempRoot: string
): void {
  const result = parsePackResult(readFileSync(supplied.packJson, "utf8"));
  assert(
    path.basename(supplied.tarball) === result.filename,
    "supplied tarball filename differs from npm pack metadata"
  );
  assert(
    result.name === expected.name && result.version === expected.version,
    "supplied tarball identity differs from tooling/package.json"
  );
  assert(
    sha512Integrity(supplied.tarball) === result.integrity,
    "supplied tarball bytes differ from npm pack integrity"
  );
  verifyInventory(result);
  comparePackedFiles(readTarballInventory(supplied.tarball), result.files);
  verifyCleanConsumer(supplied.tarball, tempRoot);
}

const suppliedPackage = parseSuppliedPackage(process.argv.slice(2));
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "genes-tooling-package-"));
try {
  const expected = verifyPackageMetadata();
  if (suppliedPackage !== null) {
    verifySuppliedPackage(suppliedPackage, expected, tempRoot);
  } else {
    const firstRoot = path.join(tempRoot, "pack-first");
    const secondRoot = path.join(tempRoot, "pack-second");
    mkdirSync(firstRoot, { recursive: true });
    mkdirSync(secondRoot, { recursive: true });
    const first = pack(firstRoot);
    const second = pack(secondRoot);
    const firstPaths = verifyInventory(first.result);
    const secondPaths = verifyInventory(second.result);
    assert(
      firstPaths.join("\n") === secondPaths.join("\n"),
      "repeated packs produced different file inventories"
    );
    assert(
      first.result.integrity === second.result.integrity,
      "repeated packs produced different sha512 integrity values"
    );
    assert(
      readFileSync(first.tarball).equals(readFileSync(second.tarball)),
      "repeated packs were not byte-identical"
    );
    const suppliedPackJson = path.join(tempRoot, "supplied-pack.json");
    writeFileSync(
      suppliedPackJson,
      `${JSON.stringify([first.result], null, 2)}\n`,
      "utf8"
    );
    verifySuppliedPackage(
      { tarball: first.tarball, packJson: suppliedPackJson },
      expected,
      tempRoot
    );
    const unreviewedPackJson = path.join(tempRoot, "unreviewed-pack.json");
    writeFileSync(
      unreviewedPackJson,
      `${JSON.stringify(
        [
          {
            ...first.result,
            files: [
              ...first.result.files,
              { path: "unreviewed.txt", size: 1, mode: 0o644 },
            ],
          },
        ],
        null,
        2
      )}\n`,
      "utf8"
    );
    expectFailure(
      () =>
        verifySuppliedPackage(
          { tarball: first.tarball, packJson: unreviewedPackJson },
          expected,
          tempRoot
        ),
      "supplied-package verification accepted an unreviewed candidate path"
    );
    const mismatchedPackJson = path.join(tempRoot, "mismatched-pack.json");
    const [firstFile, ...remainingFiles] = first.result.files;
    assert(firstFile !== undefined, "packed candidate unexpectedly has no files");
    writeFileSync(
      mismatchedPackJson,
      `${JSON.stringify(
        [
          {
            ...first.result,
            files: [
              { ...firstFile, size: firstFile.size + 1 },
              ...remainingFiles,
            ],
          },
        ],
        null,
        2
      )}\n`,
      "utf8"
    );
    expectFailure(
      () =>
        verifySuppliedPackage(
          { tarball: first.tarball, packJson: mismatchedPackJson },
          expected,
          tempRoot
        ),
      "supplied-package verification accepted metadata for different archive entries"
    );
    verifyReleaseEvidence(first, tempRoot);
    console.log(
      `tooling-package:ok (${first.result.name}@${first.result.version}; ${first.result.files.length} files; ${first.result.integrity})`
    );
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
