import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const canonicalManifestPath = path.join(repoRoot, "examples", "todoapp", "feature-coverage.json");
const manifestPath = process.env.GENES_TODOAPP_FEATURE_MANIFEST ?? canonicalManifestPath;

type JsonRecord = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(`Todoapp feature coverage: ${message}`);
}

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object`);
  return value as JsonRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "")
    fail(`${label} must be a non-empty string`);
  return value;
}

function strings(value: unknown, label: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0))
    fail(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  const result = value.map((entry, index) => text(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length)
    fail(`${label} contains duplicates`);
  return result;
}

const manifest = record(JSON.parse(readFileSync(manifestPath, "utf8")), "manifest");
if (manifest.schemaVersion !== 1
  || manifest.contract !== "genes-todoapp-stable-feature-coverage")
  fail("unsupported schema or contract");
text(manifest.statement, "statement");

const expectedColumns = [
  "typescript-tsx",
  "typescript-low-level",
  "typescript-minimal",
  "classic-js",
  "classic-dts",
  "node-runtime",
  "browser-runtime",
  "focused-fixture"
];
const columns = strings(manifest.profileColumns, "profileColumns");
if (JSON.stringify(columns) !== JSON.stringify(expectedColumns))
  fail(`profileColumns must be exactly ${expectedColumns.join(", ")}`);

const packageJson = record(JSON.parse(readFileSync(
  path.join(repoRoot, "package.json"), "utf8"
)), "package.json");
const packageScripts = record(packageJson.scripts, "package.json.scripts");
const owners = record(manifest.evidenceOwners, "evidenceOwners");
const ownerIds = Object.keys(owners);
if (ownerIds.length === 0) fail("evidenceOwners must not be empty");
for (const ownerId of ownerIds) {
  const owner = record(owners[ownerId], `evidenceOwners.${ownerId}`);
  for (const packageScript of strings(owner.packageScripts,
    `${ownerId}.packageScripts`)) {
    if (typeof packageScripts[packageScript] !== "string")
      fail(`${ownerId} references missing package script ${packageScript}`);
  }
  if (owner.arguments !== undefined) {
    strings(owner.arguments, `${ownerId}.arguments`, true);
    if ((owner.packageScripts as unknown[]).length !== 1)
      fail(`${ownerId}.arguments requires exactly one package script`);
  }
  for (const ownerPath of strings(owner.paths, `${ownerId}.paths`)) {
    if (!existsSync(path.join(repoRoot, ownerPath)))
      fail(`${ownerId} references missing path ${ownerPath}`);
  }
}

const beadIds = new Set<string>();
for (const line of readFileSync(path.join(repoRoot, ".beads", "issues.jsonl"), "utf8")
  .split(/\r?\n/u)) {
  if (line.trim() === "") continue;
  const issue = record(JSON.parse(line), "Beads snapshot row");
  if (typeof issue.id === "string") beadIds.add(issue.id);
}

const validStatuses = new Set(["covered", "partial", "gap", "not-applicable"]);
const requiredFamilies = new Set([
  "language-runtime",
  "modules-imports",
  "nullish-boundaries",
  "public-surface",
  "ecosystem-interop",
  "react-hxx",
  "reachability",
  "provenance-publication",
  "quality-performance",
  "migration-tooling"
]);
if (!Array.isArray(manifest.features) || manifest.features.length === 0)
  fail("features must be a non-empty array");

const featureIds: string[] = [];
const seenFamilies = new Set<string>();
for (const [index, rawFeature] of manifest.features.entries()) {
  const feature = record(rawFeature, `features[${index}]`);
  const id = text(feature.id, `features[${index}].id`);
  if (!/^[a-z][a-z0-9-]*\.[a-z0-9-]+$/u.test(id))
    fail(`${id} must use stable family.feature-id spelling`);
  featureIds.push(id);
  const family = text(feature.family, `${id}.family`);
  if (!requiredFamilies.has(family)) fail(`${id} uses unknown family ${family}`);
  seenFamilies.add(family);
  text(feature.claim, `${id}.claim`);

  const coverage = record(feature.coverage, `${id}.coverage`);
  const evidence = record(feature.evidence, `${id}.evidence`);
  if (JSON.stringify(Object.keys(coverage)) !== JSON.stringify(expectedColumns))
    fail(`${id}.coverage must name every profile column in canonical order`);
  for (const column of expectedColumns) {
    const status = text(coverage[column], `${id}.coverage.${column}`);
    if (!validStatuses.has(status)) fail(`${id}.${column} has unknown status ${status}`);
    const evidenceIds = evidence[column] === undefined
      ? []
      : strings(evidence[column], `${id}.evidence.${column}`);
    for (const evidenceId of evidenceIds) {
      if (!(evidenceId in owners))
        fail(`${id}.${column} references unknown evidence owner ${evidenceId}`);
    }
    if ((status === "covered" || status === "partial") && evidenceIds.length === 0)
      fail(`${id}.${column} is ${status} without evidence`);
    if (status === "not-applicable" && evidenceIds.length > 0)
      fail(`${id}.${column} is not-applicable but still claims evidence`);
  }
  for (const column of Object.keys(evidence)) {
    if (!expectedColumns.includes(column)) fail(`${id}.evidence has unknown column ${column}`);
  }
  const hasGap = Object.values(coverage).some((status) => status === "gap" || status === "partial");
  if (hasGap) {
    const gapBead = text(feature.gapBead, `${id}.gapBead`);
    if (!beadIds.has(gapBead)) fail(`${id} references missing gap Bead ${gapBead}`);
  } else if (feature.gapBead !== undefined) {
    fail(`${id} names a gap Bead without a partial or gap disposition`);
  }
  if (coverage["focused-fixture"] !== "covered")
    fail(`${id} must retain a focused evidence owner`);
}

if (new Set(featureIds).size !== featureIds.length)
  fail("stable feature IDs must be unique");
for (const family of requiredFamilies) {
  if (!seenFamilies.has(family)) fail(`missing stable feature family ${family}`);
}

if (process.env.GENES_TODOAPP_FEATURE_SENSITIVITY !== "1") {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "genes-todoapp-feature-coverage-"));
  try {
    const source = JSON.parse(readFileSync(canonicalManifestPath, "utf8")) as JsonRecord;
    const mutations: Array<[string, (copy: JsonRecord) => void]> = [
      ["missing stable feature ID", (copy) => {
        delete record((copy.features as unknown[])[0], "first feature").id;
      }],
      ["duplicate stable feature ID", (copy) => {
        const features = copy.features as unknown[];
        features.push(JSON.parse(JSON.stringify(features[0])) as unknown);
      }],
      ["dead package-script owner", (copy) => {
        record(record(copy.evidenceOwners, "evidenceOwners")["todoapp-build"],
          "todoapp-build").packageScripts = ["test:does-not-exist"];
      }],
      ["dead file owner", (copy) => {
        record(record(copy.evidenceOwners, "evidenceOwners")["todoapp-build"],
          "todoapp-build").paths = ["examples/todoapp/does-not-exist.hx"];
      }]
    ];
    for (const [index, [label, mutate]] of mutations.entries()) {
      const copy = JSON.parse(JSON.stringify(source)) as JsonRecord;
      mutate(copy);
      const changedPath = path.join(tempRoot, `mutation-${index}.json`);
      writeFileSync(changedPath, `${JSON.stringify(copy, null, 2)}\n`, "utf8");
      const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GENES_TODOAPP_FEATURE_MANIFEST: changedPath,
          GENES_TODOAPP_FEATURE_SENSITIVITY: "1"
        }
      });
      if (result.status === 0)
        fail(`sensitivity control stayed green for ${label}`);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

console.log(`todoapp-feature-coverage:ok (${featureIds.length} stable features, ${ownerIds.length} evidence owners, sensitivity controls red)`);
