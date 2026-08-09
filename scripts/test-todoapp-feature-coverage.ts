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

function onlyKeys(value: JsonRecord, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) fail(`${label} has unknown field(s): ${unknown.join(", ")}`);
}

const manifest = record(JSON.parse(readFileSync(manifestPath, "utf8")), "manifest");
onlyKeys(manifest, [
  "schemaVersion", "contract", "statement", "profileColumns",
  "evidenceOwners", "features"
], "manifest");
if (manifest.schemaVersion !== 2
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
  if (!/^[a-z][a-z0-9-]+$/u.test(ownerId))
    fail(`${ownerId} must use stable kebab-case spelling`);
  onlyKeys(owner, ["packageScripts", "arguments", "paths"],
    `evidenceOwners.${ownerId}`);
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

const beadStatuses = new Map<string, string>();
for (const line of readFileSync(path.join(repoRoot, ".beads", "issues.jsonl"), "utf8")
  .split(/\r?\n/u)) {
  if (line.trim() === "") continue;
  const issue = record(JSON.parse(line), "Beads snapshot row");
  if (typeof issue.id === "string" && typeof issue.status === "string")
    beadStatuses.set(issue.id, issue.status);
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
const expectedFeatureIds = [
  "language.classes-interfaces-collections",
  "language.generics-abstracts-enums",
  "language.control-flow-evaluation-order",
  "language.strings-templates-arrays-maps",
  "runtime.minimal-profile",
  "runtime.reflection-resources",
  "language.async-errors-finally",
  "modules.esm-binding-identity",
  "modules.side-effects-attributes-dynamic-import",
  "modules.functions-directives",
  "nullish.null-undefined-optional",
  "typing.public-types-and-declarations",
  "interop.haxe-imports-authored-typescript",
  "interop.typescript-imports-generated-haxe",
  "interop.host-globals-callbacks-native-values",
  "react.hxx-tsx-create-element",
  "react.hooks-events-routing",
  "reachability.dce-and-library-surface",
  "quality.binding-and-name-collisions",
  "provenance.source-maps",
  "lifecycle.compiler-server-fresh-build",
  "publication.output-transaction",
  "quality.determinism-output-performance",
  "migration.ts2hx-roundtrip"
];
const applicationColumns = expectedColumns.filter((column) => column !== "focused-fixture");
const liveBeadStatuses = new Set(["open", "in_progress"]);
if (!Array.isArray(manifest.features) || manifest.features.length === 0)
  fail("features must be a non-empty array");

const featureIds: string[] = [];
const seenFamilies = new Set<string>();
for (const [index, rawFeature] of manifest.features.entries()) {
  const feature = record(rawFeature, `features[${index}]`);
  onlyKeys(feature, [
    "id", "family", "claim", "coverage", "evidence", "applicationDisposition", "notes"
  ], `features[${index}]`);
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
  if (coverage["focused-fixture"] !== "covered")
    fail(`${id} must retain a focused evidence owner`);

  const applicationStatuses = applicationColumns.map((column) => coverage[column]);
  const hasPartialApplicationStatus = applicationStatuses.some((status) => status === "partial");
  const hasGapApplicationStatus = applicationStatuses.some((status) => status === "gap");
  const hasIncompleteApplicationStatus = hasPartialApplicationStatus || hasGapApplicationStatus;
  const applicationIsNotApplicable = applicationStatuses.every(
    (status) => status === "not-applicable"
  );
  const requiresDisposition = hasIncompleteApplicationStatus || applicationIsNotApplicable;
  if (requiresDisposition) {
    const disposition = record(feature.applicationDisposition, `${id}.applicationDisposition`);
    onlyKeys(disposition, ["kind", "owner", "rationale", "revisitTrigger"],
      `${id}.applicationDisposition`);
    const kind = text(disposition.kind, `${id}.applicationDisposition.kind`);
    const owner = text(disposition.owner, `${id}.applicationDisposition.owner`);
    text(disposition.rationale, `${id}.applicationDisposition.rationale`);
    text(disposition.revisitTrigger, `${id}.applicationDisposition.revisitTrigger`);
    const focusedOwners = evidence["focused-fixture"] as string[];
    switch (kind) {
      case "planned": {
        if (!hasIncompleteApplicationStatus)
          fail(`${id} is planned without a partial or gap application status`);
        const status = beadStatuses.get(owner);
        if (status === undefined)
          fail(`${id} references missing planned Bead ${owner}`);
        if (!liveBeadStatuses.has(status))
          fail(`${id} planned Bead ${owner} is ${status}, not open or in progress`);
        break;
      }
      case "focused-only":
        if (!hasPartialApplicationStatus || hasGapApplicationStatus)
          fail(`${id} focused-only scope must have partial evidence and no application gap`);
        if (!focusedOwners.includes(owner))
          fail(`${id} focused-only owner ${owner} is not its focused-fixture evidence owner`);
        break;
      case "not-applicable":
        if (!applicationIsNotApplicable)
          fail(`${id} not-applicable scope must mark every application column not-applicable`);
        if (!focusedOwners.includes(owner))
          fail(`${id} not-applicable owner ${owner} is not its focused-fixture evidence owner`);
        break;
      default:
        fail(`${id}.applicationDisposition.kind has unknown value ${kind}`);
    }
  } else if (feature.applicationDisposition !== undefined) {
    fail(`${id} names an application disposition without an incomplete or wholly inapplicable application claim`);
  }
  if (feature.notes !== undefined) text(feature.notes, `${id}.notes`);
}

if (new Set(featureIds).size !== featureIds.length)
  fail("stable feature IDs must be unique");
if (JSON.stringify(featureIds) !== JSON.stringify(expectedFeatureIds))
  fail("stable feature IDs or canonical order changed without updating the independent inventory");
for (const family of requiredFamilies) {
  if (!seenFamilies.has(family)) fail(`missing stable feature family ${family}`);
}

if (process.env.GENES_TODOAPP_FEATURE_SENSITIVITY !== "1") {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "genes-todoapp-feature-coverage-"));
  try {
    const source = JSON.parse(readFileSync(canonicalManifestPath, "utf8")) as JsonRecord;
    const feature = (copy: JsonRecord, id: string): JsonRecord => {
      const match = (copy.features as unknown[]).find((entry) => record(entry, "feature").id === id);
      if (match === undefined) fail(`sensitivity fixture is missing ${id}`);
      return record(match, id);
    };
    const mutations: Array<[string, string, (copy: JsonRecord) => void]> = [
      ["missing stable feature ID", "features[0].id must be a non-empty string", (copy) => {
        delete record((copy.features as unknown[])[0], "first feature").id;
      }],
      ["duplicate stable feature ID", "stable feature IDs must be unique", (copy) => {
        const features = copy.features as unknown[];
        features.push(JSON.parse(JSON.stringify(features[0])) as unknown);
      }],
      ["deleted stable feature declaration", "stable feature IDs or canonical order changed", (copy) => {
        (copy.features as unknown[]).splice(3, 1);
      }],
      ["dead package-script owner", "references missing package script", (copy) => {
        record(record(copy.evidenceOwners, "evidenceOwners")["todoapp-build"],
          "todoapp-build").packageScripts = ["test:does-not-exist"];
      }],
      ["dead file owner", "references missing path", (copy) => {
        record(record(copy.evidenceOwners, "evidenceOwners")["todoapp-build"],
          "todoapp-build").paths = ["examples/todoapp/does-not-exist.hx"];
      }],
      ["missing application disposition", "applicationDisposition must be an object", (copy) => {
        delete feature(copy, "language.generics-abstracts-enums").applicationDisposition;
      }],
      ["wrong focused owner kind", "is not its focused-fixture evidence owner", (copy) => {
        record(feature(copy, "language.generics-abstracts-enums").applicationDisposition,
          "applicationDisposition").owner = "genes-1x1g.7";
      }],
      ["missing planned Bead", "references missing planned Bead", (copy) => {
        record(feature(copy, "runtime.minimal-profile").applicationDisposition,
          "applicationDisposition").owner = "genes-does-not-exist";
      }],
      ["closed planned Bead", "is closed, not open or in progress", (copy) => {
        record(feature(copy, "runtime.minimal-profile").applicationDisposition,
          "applicationDisposition").owner = "genes-1x1g.2.2";
      }],
      ["unreferenced focused evidence owner", "is not its focused-fixture evidence owner", (copy) => {
        record(feature(copy, "reachability.dce-and-library-surface").applicationDisposition,
          "applicationDisposition").owner = "compiler-core";
      }],
      ["missing disposition rationale", "applicationDisposition.rationale must be a non-empty string", (copy) => {
        delete record(feature(copy, "language.strings-templates-arrays-maps").applicationDisposition,
          "applicationDisposition").rationale;
      }],
      ["missing disposition revisit trigger", "applicationDisposition.revisitTrigger must be a non-empty string", (copy) => {
        delete record(feature(copy, "modules.functions-directives").applicationDisposition,
          "applicationDisposition").revisitTrigger;
      }],
      ["not-applicable application evidence", "is not-applicable but still claims evidence", (copy) => {
        const target = feature(copy, "migration.ts2hx-roundtrip");
        record(target.evidence, "evidence")["typescript-tsx"] = ["ts2hx"];
      }]
    ];
    for (const [index, [label, expectedFailure, mutate]] of mutations.entries()) {
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
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      if (!output.includes(expectedFailure))
        fail(`sensitivity control for ${label} failed for the wrong reason; expected ${expectedFailure}`);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

console.log(`todoapp-feature-coverage:ok (${featureIds.length} stable features, ${ownerIds.length} evidence owners, sensitivity controls red)`);
