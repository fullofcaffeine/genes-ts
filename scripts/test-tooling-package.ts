import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const toolingRoot = path.join(repoRoot, "tooling");

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

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  "./haxe-server",
  "./haxe-wait-server/v1/vectors.json",
  "./haxe-wait-server/v1/vectors.schema.json",
  "./hxml",
  "./loop",
  "./watch",
  "./watch-orchestration/v1/vectors.json",
  "./watch-orchestration/v1/vectors.schema.json",
] as const;

const forbiddenSegments = [
  "crash-fixture",
  "haxe-server-test",
  "haxe-server-vector-test",
  "hxml-test",
  "loop-test",
  "test",
  "vector-fixture",
  "vector-test",
  "watch-test",
  "watch-vector-test",
];

function isAllowedDistFile(file: string): boolean {
  if (!file.startsWith("dist/")) return false;
  if (
    !(
      file.endsWith(".js") ||
      file.endsWith(".js.map") ||
      file.endsWith(".d.ts") ||
      file.endsWith(".d.ts.map")
    )
  ) {
    return false;
  }
  return !forbiddenSegments.some((segment) =>
    file.split("/").some((part) => part === segment)
  );
}

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
    assert(
      metadataFiles.has(file.path) ||
        protocolFiles.has(file.path) ||
        isAllowedDistFile(file.path),
      `packed package contains an unreviewed path: ${file.path}`
    );
  }
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
  ];
  for (const entrypoint of requiredEntrypoints) {
    assert(paths.includes(entrypoint), `packed package is missing ${entrypoint}`);
  }
  return sorted;
}

function verifyPackageMetadata(): void {
  const packageJson = readJsonObject(
    path.join(toolingRoot, "package.json"),
    "tooling/package.json"
  );
  assert(
    packageJson.dependencies === undefined,
    "@genes-ts/tooling must remain dependency-free unless release policy is explicitly expanded"
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
    `import { publishArtifacts, type PublicationPlan } from "@genes-ts/tooling";
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
import artifactProtocol from "@genes-ts/tooling/artifact-transactions/v1/protocol.schema.json" with { type: "json" };
import artifactVectors from "@genes-ts/tooling/artifact-transactions/v1/vectors.json" with { type: "json" };
import artifactVectorSchema from "@genes-ts/tooling/artifact-transactions/v1/vectors.schema.json" with { type: "json" };
import waitVectors from "@genes-ts/tooling/haxe-wait-server/v1/vectors.json" with { type: "json" };
import waitVectorSchema from "@genes-ts/tooling/haxe-wait-server/v1/vectors.schema.json" with { type: "json" };
import watchVectors from "@genes-ts/tooling/watch-orchestration/v1/vectors.json" with { type: "json" };
import watchVectorSchema from "@genes-ts/tooling/watch-orchestration/v1/vectors.schema.json" with { type: "json" };

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
];
const typeWitness:
  | PublicationPlan
  | HxmlInventory
  | HaxeWaitEndpoint
  | ReconciledWatchSession
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
import * as watch from "@genes-ts/tooling/watch";
import artifactProtocol from "@genes-ts/tooling/artifact-transactions/v1/protocol.schema.json" with { type: "json" };
import artifactVectors from "@genes-ts/tooling/artifact-transactions/v1/vectors.json" with { type: "json" };
import artifactVectorSchema from "@genes-ts/tooling/artifact-transactions/v1/vectors.schema.json" with { type: "json" };
import waitVectors from "@genes-ts/tooling/haxe-wait-server/v1/vectors.json" with { type: "json" };
import waitVectorSchema from "@genes-ts/tooling/haxe-wait-server/v1/vectors.schema.json" with { type: "json" };
import watchVectors from "@genes-ts/tooling/watch-orchestration/v1/vectors.json" with { type: "json" };
import watchVectorSchema from "@genes-ts/tooling/watch-orchestration/v1/vectors.schema.json" with { type: "json" };

const witnesses = [
  root.publishArtifacts,
  artifacts.recoverArtifacts,
  hxml.inventoryHxml,
  loop.SerializedDirtyLoop,
  server.OwnedHaxeWaitServer,
  server.reserveLoopbackEndpoint,
  watch.watchReconciledInputs,
];
if (witnesses.some((value) => typeof value !== "function")) {
  throw new Error("a public tooling runtime export is missing");
}
for (const vectors of [
  artifactProtocol,
  artifactVectors,
  artifactVectorSchema,
  waitVectors,
  waitVectorSchema,
  watchVectors,
  watchVectorSchema,
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

function parseTarballArgument(args: readonly string[]): string | null {
  if (args.length === 0) return null;
  assert(
    args.length === 2 && args[0] === "--tarball",
    "usage: test-tooling-package [--tarball <package.tgz>]"
  );
  return path.resolve(args[1]);
}

const suppliedTarball = parseTarballArgument(process.argv.slice(2));
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "genes-tooling-package-"));
try {
  verifyPackageMetadata();
  if (suppliedTarball !== null) {
    assert(
      readdirSync(path.dirname(suppliedTarball)).includes(
        path.basename(suppliedTarball)
      ),
      `supplied tarball does not exist: ${suppliedTarball}`
    );
    verifyCleanConsumer(suppliedTarball, tempRoot);
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
    verifyReleaseEvidence(first, tempRoot);
    verifyCleanConsumer(first.tarball, tempRoot);
    console.log(
      `tooling-package:ok (${first.result.name}@${first.result.version}; ${first.result.files.length} files; ${first.result.integrity})`
    );
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
