import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadDownstreamContracts } from "./downstream-contracts.js";
import { toolchains } from "./toolchains.js";

type EvidenceClassId =
  | "compile_inventory"
  | "strict_public_typing"
  | "semantic_differential"
  | "snapshot"
  | "smoke"
  | "toolchain"
  | "package_shape"
  | "downstream";

type MetricKind =
  | "tracked-files"
  | "json-array"
  | "json-object-keys"
  | "json-array-total"
  | "source-pattern";

interface MetricInput {
  readonly id: string;
  readonly label: string;
  readonly kind: MetricKind;
  readonly path: string;
  readonly match?: string;
  readonly pointer?: ReadonlyArray<string>;
  readonly child?: string;
  readonly expected: number;
}

interface MetricResult extends MetricInput {
  readonly count: number;
}

interface EvidenceClass {
  readonly id: EvidenceClassId;
  readonly label: string;
  readonly meaning: string;
}

interface BucketInput {
  readonly id: string;
  readonly class: EvidenceClassId;
  readonly label: string;
  readonly disposition: "blocking" | "nonblocking-nightly";
  readonly scope: string;
  readonly evidence: ReadonlyArray<string>;
  readonly commands: ReadonlyArray<string>;
  readonly metrics: ReadonlyArray<MetricInput>;
  readonly proves: string;
  readonly doesNotProve: string;
}

interface BucketResult extends Omit<BucketInput, "metrics"> {
  readonly metrics: ReadonlyArray<MetricResult>;
}

interface EvidenceManifest {
  readonly schemaVersion: 1;
  readonly contract: "genes-ts-compatibility-evidence";
  readonly statement: string;
  readonly classes: ReadonlyArray<EvidenceClass>;
  readonly buckets: ReadonlyArray<BucketInput>;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const manifestPath = path.join(repoRoot, "tests", "compatibility", "evidence.json");
const jsonOutputPath = path.join(repoRoot, "docs", "COMPATIBILITY_REPORT.json");
const markdownOutputPath = path.join(repoRoot, "docs", "COMPATIBILITY_REPORT.md");

const evidenceClassIds: ReadonlyArray<EvidenceClassId> = [
  "compile_inventory",
  "strict_public_typing",
  "semantic_differential",
  "snapshot",
  "smoke",
  "toolchain",
  "package_shape",
  "downstream"
];
const metricKinds = new Set<MetricKind>([
  "tracked-files",
  "json-array",
  "json-object-keys",
  "json-array-total",
  "source-pattern"
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, label: string): ReadonlyArray<string> {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, index) => nonEmptyString(entry, `${label}[${index}]`));
}

function safeRepoPath(value: unknown, label: string): string {
  const relative = nonEmptyString(value, label).replaceAll("\\", "/");
  if (relative.startsWith("/") || relative.split("/").includes("..")) {
    throw new Error(`${label} must be repository-relative`);
  }
  const absolute = path.resolve(repoRoot, relative);
  if (!absolute.startsWith(`${repoRoot}${path.sep}`) || !existsSync(absolute)) {
    throw new Error(`${label} does not exist: ${relative}`);
  }
  return relative;
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value as number;
}

function uniqueIds(values: ReadonlyArray<{ readonly id: string }>, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) throw new Error(`${label} contains duplicate id ${value.id}`);
    seen.add(value.id);
  }
}

function parseMetric(value: unknown, label: string): MetricInput {
  const input = record(value, label);
  const kind = nonEmptyString(input.kind, `${label}.kind`);
  if (!metricKinds.has(kind as MetricKind)) {
    throw new Error(`${label}.kind is unsupported: ${kind}`);
  }
  const pointer = input.pointer === undefined
    ? undefined
    : stringArray(input.pointer, `${label}.pointer`);
  const match = input.match === undefined
    ? undefined
    : nonEmptyString(input.match, `${label}.match`);
  const child = input.child === undefined
    ? undefined
    : nonEmptyString(input.child, `${label}.child`);
  if ((kind === "tracked-files" || kind === "source-pattern") && !match) {
    throw new Error(`${label}.match is required for ${kind}`);
  }
  if (kind.startsWith("json-") && pointer === undefined) {
    throw new Error(`${label}.pointer is required for ${kind}`);
  }
  return {
    id: nonEmptyString(input.id, `${label}.id`),
    label: nonEmptyString(input.label, `${label}.label`),
    kind: kind as MetricKind,
    path: safeRepoPath(input.path, `${label}.path`),
    match,
    pointer,
    child,
    expected: integer(input.expected, `${label}.expected`)
  };
}

function parseBucket(value: unknown, index: number): BucketInput {
  const label = `buckets[${index}]`;
  const input = record(value, label);
  const classId = nonEmptyString(input.class, `${label}.class`);
  if (!evidenceClassIds.includes(classId as EvidenceClassId)) {
    throw new Error(`${label}.class is unsupported: ${classId}`);
  }
  const disposition = nonEmptyString(input.disposition, `${label}.disposition`);
  if (disposition !== "blocking" && disposition !== "nonblocking-nightly") {
    throw new Error(`${label}.disposition is unsupported: ${disposition}`);
  }
  if (!Array.isArray(input.metrics) || input.metrics.length === 0) {
    throw new Error(`${label}.metrics must be a non-empty array`);
  }
  const evidence = stringArray(input.evidence, `${label}.evidence`).map((entry, evidenceIndex) =>
    safeRepoPath(entry, `${label}.evidence[${evidenceIndex}]`)
  );
  const metrics = input.metrics.map((entry, metricIndex) =>
    parseMetric(entry, `${label}.metrics[${metricIndex}]`)
  );
  uniqueIds(metrics, `${label}.metrics`);
  return {
    id: nonEmptyString(input.id, `${label}.id`),
    class: classId as EvidenceClassId,
    label: nonEmptyString(input.label, `${label}.label`),
    disposition,
    scope: nonEmptyString(input.scope, `${label}.scope`),
    evidence,
    commands: stringArray(input.commands, `${label}.commands`),
    metrics,
    proves: nonEmptyString(input.proves, `${label}.proves`),
    doesNotProve: nonEmptyString(input.doesNotProve, `${label}.doesNotProve`)
  };
}

function loadEvidenceManifest(): EvidenceManifest {
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  const input = record(parsed, "compatibility evidence manifest");
  if (input.schemaVersion !== 1 || input.contract !== "genes-ts-compatibility-evidence") {
    throw new Error("compatibility evidence schema/contract is unsupported");
  }
  if (!Array.isArray(input.classes) || !Array.isArray(input.buckets)) {
    throw new Error("compatibility evidence must define classes and buckets arrays");
  }
  const classes = input.classes.map((entry, index): EvidenceClass => {
    const item = record(entry, `classes[${index}]`);
    const id = nonEmptyString(item.id, `classes[${index}].id`);
    if (id !== evidenceClassIds[index]) {
      throw new Error(
        `classes[${index}].id must be ${String(evidenceClassIds[index])}, found ${id}`
      );
    }
    return {
      id: id as EvidenceClassId,
      label: nonEmptyString(item.label, `classes[${index}].label`),
      meaning: nonEmptyString(item.meaning, `classes[${index}].meaning`)
    };
  });
  if (classes.length !== evidenceClassIds.length) {
    throw new Error(`compatibility evidence must define ${evidenceClassIds.length} classes`);
  }
  const buckets = input.buckets.map(parseBucket);
  uniqueIds(buckets, "compatibility buckets");
  for (const classId of evidenceClassIds) {
    if (!buckets.some((bucket) => bucket.class === classId)) {
      throw new Error(`compatibility class ${classId} has no evidence bucket`);
    }
  }
  return {
    schemaVersion: 1,
    contract: "genes-ts-compatibility-evidence",
    statement: nonEmptyString(input.statement, "compatibility evidence statement"),
    classes,
    buckets
  };
}

function resolvePointer(value: unknown, pointer: ReadonlyArray<string>, label: string): unknown {
  let current = value;
  for (const segment of pointer) {
    const item = record(current, label);
    if (!(segment in item)) throw new Error(`${label} is missing pointer segment ${segment}`);
    current = item[segment];
  }
  return current;
}

function trackedFiles(relativeRoot: string): ReadonlyArray<string> {
  const output = execFileSync("git", ["ls-files", "-z", "--", relativeRoot], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  const prefix = relativeRoot.endsWith("/") ? relativeRoot : `${relativeRoot}/`;
  return output
    .split("\u0000")
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.startsWith(prefix) ? entry.slice(prefix.length) : entry);
}

function arrayTotal(value: unknown, child: string | undefined, label: string): number {
  if (child) {
    if (!Array.isArray(value)) throw new Error(`${label} must resolve to an array`);
    return value.reduce((sum, entry, index) => {
      const item = record(entry, `${label}[${index}]`);
      const nested = item[child];
      if (!Array.isArray(nested)) throw new Error(`${label}[${index}].${child} must be an array`);
      return sum + nested.length;
    }, 0);
  }
  const item = record(value, label);
  return Object.values(item).reduce<number>((sum, entry) => {
    if (!Array.isArray(entry)) throw new Error(`${label} values must all be arrays`);
    return sum + entry.length;
  }, 0);
}

function evaluateMetric(metric: MetricInput): MetricResult {
  const absolutePath = path.join(repoRoot, metric.path);
  let count: number;
  if (metric.kind === "tracked-files") {
    const expression = new RegExp(metric.match ?? "");
    count = trackedFiles(metric.path).filter((entry) => expression.test(entry)).length;
  } else if (metric.kind === "source-pattern") {
    const expression = new RegExp(metric.match ?? "", "g");
    count = [...readFileSync(absolutePath, "utf8").matchAll(expression)].length;
  } else {
    const parsed: unknown = JSON.parse(readFileSync(absolutePath, "utf8"));
    const selected = resolvePointer(parsed, metric.pointer ?? [], `${metric.path} pointer`);
    if (metric.kind === "json-array") {
      if (!Array.isArray(selected)) throw new Error(`${metric.path} pointer must resolve to an array`);
      count = selected.length;
    } else if (metric.kind === "json-object-keys") {
      count = Object.keys(record(selected, `${metric.path} pointer`)).length;
    } else {
      count = arrayTotal(selected, metric.child, `${metric.path} pointer`);
    }
  }
  if (count !== metric.expected) {
    throw new Error(
      `${metric.id}: expected ${metric.expected}, found ${count}; update the manifest only for intentional evidence drift`
    );
  }
  return { ...metric, count };
}

function markdownPath(relative: string): string {
  return `../${relative}`;
}

function renderMarkdown(report: ReturnType<typeof createReport>): string {
  const lines: string[] = [
    "# genes-ts Compatibility Evidence",
    "",
    "This file is generated deterministically by `yarn report:compatibility --write`.",
    "",
    "## Reading this report",
    "",
    report.statement,
    "",
    "This is an evidence contract, not a cached CI-success badge. `blocking` and `nonblocking-nightly` describe enforcement; current run results remain in CI. Compile, typing, semantic, snapshot, smoke, package, and downstream evidence are intentionally not merged into one score.",
    "",
    "## Coverage counts",
    "",
    "| Evidence class | Metric | Exact count | Disposition |",
    "| --- | --- | ---: | --- |"
  ];
  for (const bucket of report.buckets) {
    const classLabel = report.classes.find((entry) => entry.id === bucket.class)?.label ?? bucket.class;
    for (const metric of bucket.metrics) {
      lines.push(`| ${classLabel} | ${metric.label} | ${metric.count} | \`${bucket.disposition}\` |`);
    }
  }

  lines.push("", "## Toolchain contract", "", "| Surface | Lane | Pin | Contract |", "| --- | --- | --- | --- |");
  lines.push(`| Node | stable | ${report.toolchains.node.stable} | blocking runtime lane |`);
  lines.push(`| Node | latest LTS | ${report.toolchains.node.nextLts} | blocking runtime lane |`);
  lines.push(`| Haxe | stable | ${report.toolchains.haxe.stable} | blocking compiler lane |`);
  lines.push(`| Haxe | preview | ${report.toolchains.haxe.preview} | nonblocking early warning |`);
  for (const [lane, contract] of Object.entries(report.toolchains.typescript)) {
    lines.push(`| TypeScript | ${lane} | ${contract.version} | ${contract.contract} |`);
  }
  lines.push(
    `| dts2hx | declaration ingestion | ${report.toolchains.dts2hx.version} / TS ${report.toolchains.dts2hx.typescriptVersion} / [${report.toolchains.dts2hx.sourceAuditRevision.slice(0, 12)}](https://github.com/haxiomic/dts2hx/commit/${report.toolchains.dts2hx.sourceAuditRevision}) | ${report.toolchains.dts2hx.contract} |`
  );

  for (const evidenceClass of report.classes) {
    lines.push("", `## ${evidenceClass.label}`, "", evidenceClass.meaning);
    for (const bucket of report.buckets.filter((entry) => entry.class === evidenceClass.id)) {
      lines.push(
        "",
        `### ${bucket.label}`,
        "",
        `- Disposition: \`${bucket.disposition}\``,
        `- Scope: ${bucket.scope}`,
        `- Proves: ${bucket.proves}`,
        `- Does not prove: ${bucket.doesNotProve}`,
        "- Evidence:"
      );
      for (const evidence of bucket.evidence) {
        lines.push(`  - [\`${evidence}\`](${markdownPath(evidence)})`);
      }
      lines.push("- Gates:");
      for (const command of bucket.commands) lines.push(`  - \`${command}\``);
    }
  }

  lines.push(
    "",
    "## Pinned downstream revisions",
    "",
    "These jobs are deliberately nonblocking and require the centralized stable Node lane before touching a checkout. Their JSON result artifacts keep the compiler candidate observation, downstream command statuses, and unsupported areas separate. A reviewed downstream-owned failure is recognized only by an exact pinned command, exit code, and complete TypeScript diagnostic set; every mismatch fails closed.",
    "",
    "| Profile | Revision | Curated commands | Pinned baseline | Disposition |",
    "| --- | --- | ---: | --- | --- |"
  );
  for (const profile of report.downstream.profiles) {
    lines.push(
      `| ${profile.label} | [\`${profile.revision.slice(0, 12)}\`](https://github.com/${profile.repository}/commit/${profile.revision}) | ${profile.commands.length} | \`${profile.baseline}\` | \`${profile.disposition}\` |`
    );
  }
  lines.push("", "## Known pinned-contract observations", "");
  const observations = report.downstream.profiles.flatMap((profile) =>
    profile.knownObservations.map((entry) => ({ profile, entry }))
  );
  if (observations.length === 0) {
    lines.push("None.", "");
  } else {
    lines.push("| Profile | Owner | Tracking | Observation |", "| --- | --- | --- | --- |");
    for (const { profile, entry } of observations) {
      lines.push(`| ${profile.id} | \`${entry.owner}\` | \`${entry.tracking}\` | ${entry.summary} |`);
    }
  }
  lines.push("", "## Explicit downstream exclusions", "");
  for (const profile of report.downstream.profiles) {
    lines.push(`### ${profile.label}`, "");
    for (const exclusion of profile.unsupported) {
      lines.push(`- \`${exclusion.id}\` — **${exclusion.status}**: ${exclusion.reason}`);
    }
    lines.push("");
  }
  lines.push(
    "## Promotion boundary",
    "",
    "A passing downstream smoke or matched downstream-owned exception cannot promote a compiler claim. An unmatched downstream failure cannot block core work as a compiler defect until the underlying Haxe/JS/TS construct is minimized into this repository and assigned to the appropriate blocking evidence class.",
    ""
  );
  return lines.join("\n");
}

function createReport() {
  const manifest = loadEvidenceManifest();
  const downstream = loadDownstreamContracts();
  const buckets: ReadonlyArray<BucketResult> = manifest.buckets.map((bucket) => ({
    ...bucket,
    metrics: bucket.metrics.map(evaluateMetric)
  }));
  return {
    schemaVersion: 1 as const,
    contract: manifest.contract,
    statement: manifest.statement,
    statusSemantics: {
      blocking: "The named gate is required by core CI/release.",
      nonblockingNightly: "The named pressure test reports evidence without blocking core changes.",
      liveResultLocation: "GitHub Actions; this deterministic file is not a cached run log."
    },
    classes: manifest.classes,
    buckets,
    toolchains,
    downstream
  };
}

function checkFile(filePath: string, expected: string): void {
  if (!existsSync(filePath)) throw new Error(`${path.relative(repoRoot, filePath)} is missing`);
  const actual = readFileSync(filePath, "utf8");
  if (actual !== expected) {
    throw new Error(
      `${path.relative(repoRoot, filePath)} is stale; run yarn report:compatibility --write`
    );
  }
}

/**
 * Rejects run-local metadata before evidence can be published.
 *
 * Why: byte-stable generation is insufficient if both the checked and written
 * forms accidentally contain the current checkout root or wall-clock time.
 * What: recursively rejects timestamp/root keys, ISO instants, file URIs, and
 * common Unix/Windows machine roots while retaining relative repository paths
 * and immutable HTTPS revision links.
 * How: validate the structured report before either serialization path so the
 * Markdown renderer cannot inherit machine-local data from the JSON model.
 */
function assertPortableReport(value: unknown, location = "report"): void {
  if (typeof value === "string") {
    const machineRoot = /(?:^|[\s("'`])\/(?:Users|home|private|tmp|workspace|var\/folders)\//;
    const windowsRoot = /(?:^|[\s("'`])[A-Za-z]:[\\/]/;
    const isoTimestamp = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z\b/;
    if (machineRoot.test(value) || windowsRoot.test(value) || value.startsWith("file://")) {
      throw new Error(`${location} contains a machine-local path`);
    }
    if (isoTimestamp.test(value)) throw new Error(`${location} contains a generated timestamp`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPortableReport(entry, `${location}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.replaceAll(/[-_]/g, "").toLowerCase();
    if (["timestamp", "generatedat", "generatedon", "cwd", "reporoot", "workspaceroot"].includes(normalizedKey)) {
      throw new Error(`${location}.${key} is forbidden in deterministic evidence`);
    }
    assertPortableReport(entry, `${location}.${key}`);
  }
}

/**
 * Generates a deterministic, non-cumulative compatibility evidence report.
 *
 * Why: a large green harness is easy to overread as blanket compiler parity.
 * What: every evidence class retains its own scope, exact count, gate, positive
 * claim, and explicit non-claim. Downstream pins and exclusions are first-class.
 * How: counts come from Git-tracked paths or validated JSON/source contracts;
 * expected-count drift fails closed. Output contains no timestamps, run times,
 * checkout roots, or other machine-local state.
 */
function main(): void {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((entry) => entry !== "--write" && entry !== "--check")) {
    throw new Error("Usage: compatibility-report [--write|--check]");
  }
  if (args.has("--write") && args.has("--check")) {
    throw new Error("Use only one of --write or --check");
  }
  const report = createReport();
  assertPortableReport(report);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);
  if (args.has("--write")) {
    writeFileSync(jsonOutputPath, json);
    writeFileSync(markdownOutputPath, markdown);
    console.log("compatibility-report:wrote docs/COMPATIBILITY_REPORT.{json,md}");
  } else if (args.has("--check")) {
    checkFile(jsonOutputPath, json);
    checkFile(markdownOutputPath, markdown);
    console.log(`compatibility-report:ok (${report.buckets.length} separated evidence buckets)`);
  } else {
    process.stdout.write(markdown);
  }
}

main();
