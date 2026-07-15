import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { SEMANTIC_FAIL_CLOSED_CASES, SEMANTIC_SUPPORT_MATRIX } from "./semantic/ir.js";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

/** Mirrors GitHub's relevant heading-slug rules for this ASCII documentation. */
function headingSlug(heading: string): string {
  return heading
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{Letter}\p{Number}\p{Mark}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function validateLocalLinks(markdownFile: string): void {
  const source = read(markdownFile);
  for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
    const href = match[1] ?? "";
    if (/^(https?:|mailto:)/.test(href)) continue;

    const [encodedPath = "", encodedFragment] = href.split("#", 2);
    const target = encodedPath.length > 0
      ? path.resolve(path.dirname(markdownFile), decodeURIComponent(encodedPath))
      : path.resolve(markdownFile);
    assert(fs.existsSync(target), `${markdownFile}: local link target does not exist: ${href}`);

    if (!encodedFragment || !fs.statSync(target).isFile()) continue;
    const expected = decodeURIComponent(encodedFragment);
    const anchors = read(target)
      .split(/\r?\n/)
      .filter((line) => /^#{1,6} /.test(line))
      .map((line) => headingSlug(line.replace(/^#{1,6} /, "")));
    assert(anchors.includes(expected), `${markdownFile}: local link anchor does not exist: ${href}`);
  }
}

/**
 * Keeps the public ts2hx documentation tied to executable repository facts.
 *
 * Why: fixture lists, semantic grades, CLI flags, and evidence counts change
 * independently. Stale migration docs can turn an intentionally bounded tool
 * into a misleading product claim even while compiler tests stay green.
 *
 * What: this gate derives the current fixture/snapshot inventory, semantic
 * catalog, and CLI options from their owners and requires the workflow,
 * limitations, usage, and index documents to acknowledge them.
 *
 * How: it performs read-only checks after the tool build. It deliberately does
 * not validate prose style or external websites; those remain review concerns.
 */
function main(): void {
  const toolRoot = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const docsRoot = path.join(repoRoot, "docs");
  const usagePath = path.join(docsRoot, "ts2hx", "USAGE.md");
  const workflowsPath = path.join(docsRoot, "ts2hx", "WORKFLOWS.md");
  const limitationsPath = path.join(docsRoot, "ts2hx", "LIMITATIONS.md");
  const portabilityPath = path.join(docsRoot, "ts2hx", "PORTABILITY.md");
  const architecturePath = path.join(docsRoot, "ARCHITECTURE.md");
  const architectureRoadmapPath = path.join(docsRoot, "ARCHITECTURE_ROADMAP.md");
  const docsIndexPath = path.join(docsRoot, "README.md");
  const topWorkflowsPath = path.join(docsRoot, "WORKFLOWS.md");
  const toolReadmePath = path.join(toolRoot, "README.md");

  for (const required of [
    usagePath,
    workflowsPath,
    limitationsPath,
    portabilityPath,
    architecturePath,
    architectureRoadmapPath,
    docsIndexPath,
    topWorkflowsPath,
    toolReadmePath
  ]) {
    assert(fs.existsSync(required), `Missing required ts2hx documentation: ${required}`);
  }

  const usage = read(usagePath);
  const limitations = read(limitationsPath);
  const architectureRoadmap = read(architectureRoadmapPath);
  const docsIndex = read(docsIndexPath);
  const topWorkflows = read(topWorkflowsPath);
  const toolReadme = read(toolReadmePath);

  for (const name of ["WORKFLOWS.md", "USAGE.md", "LIMITATIONS.md", "PORTABILITY.md"])
    assert(docsIndex.includes(`ts2hx/${name}`), `docs/README.md does not index ts2hx/${name}.`);
  assert(docsIndex.includes("ARCHITECTURE.md"), "docs/README.md does not index the contributor architecture guide.");
  assert(topWorkflows.includes("ts2hx/WORKFLOWS.md"), "Top-level workflow guide does not route to ts2hx workflows.");
  assert(topWorkflows.includes("ts2hx/LIMITATIONS.md"), "Top-level workflow guide does not route to ts2hx limitations.");
  for (const name of ["WORKFLOWS.md", "USAGE.md", "LIMITATIONS.md", "PORTABILITY.md"])
    assert(toolReadme.includes(`docs/ts2hx/${name}`), `tools/ts2hx/README.md does not route to ${name}.`);
  assert(
    toolReadme.includes("docs/ARCHITECTURE.md#contributing-a-ts2hx-fixture"),
    "tools/ts2hx/README.md does not route contributors to the architecture fixture guide."
  );

  const fixtureRoot = path.join(toolRoot, "fixtures");
  const fixtures = fs.readdirSync(fixtureRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(fixtureRoot, entry.name, "tsconfig.json")))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  for (const fixture of fixtures)
    assert(usage.includes(`\`${fixture}\``), `USAGE.md does not list fixture ${fixture}.`);

  const snapshotsRoot = path.join(toolRoot, "tests_snapshots");
  const snapshotProjects = fs.readdirSync(snapshotsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const snapshotFiles = walkFiles(snapshotsRoot);
  for (const fixture of snapshotProjects)
    assert(usage.includes(`\`${fixture}\``), `USAGE.md does not list snapshot owner ${fixture}.`);
  assert(
    usage.includes(`snapshot runner currently owns these ${snapshotProjects.length} projects`),
    `USAGE.md snapshot-project count is stale; expected ${snapshotProjects.length}.`
  );
  assert(
    usage.includes(`current snapshot is ${snapshotFiles.length} generated files`),
    `USAGE.md snapshot-file count is stale; expected ${snapshotFiles.length}.`
  );
  assert(
    architectureRoadmap.includes(`${snapshotFiles.length} reviewed snapshot files`),
    `ARCHITECTURE_ROADMAP.md snapshot-file count is stale; expected ${snapshotFiles.length}.`
  );

  for (const feature of SEMANTIC_SUPPORT_MATRIX)
    assert(limitations.includes(`\`${feature.id}\``), `LIMITATIONS.md omits semantic feature ${feature.id}.`);
  const supportedCount = SEMANTIC_SUPPORT_MATRIX.filter((feature) => feature.support !== "unsupported").length;
  const unsupportedCount = SEMANTIC_SUPPORT_MATRIX.length - supportedCount;
  const failClosedCount = SEMANTIC_FAIL_CLOSED_CASES.length;
  assert(
    usage.includes(`${supportedCount} supported semantic contracts`),
    `USAGE.md supported semantic count is stale; expected ${supportedCount}.`
  );
  assert(
    usage.includes(`${failClosedCount} feature-specific strict failures`),
    `USAGE.md fail-closed semantic count is stale; expected ${failClosedCount}.`
  );
  assert(
    limitations.includes(`${supportedCount} supported rows`) && limitations.includes(`${unsupportedCount} unsupported rows`),
    "LIMITATIONS.md semantic support counts are stale."
  );
  assert(
    architectureRoadmap.includes(`${supportedCount} supported semantic rows`)
      && architectureRoadmap.includes(`${unsupportedCount} unsupported rows`)
      && architectureRoadmap.includes(`${failClosedCount} exercised fail-closed variants`),
    "ARCHITECTURE_ROADMAP.md semantic evidence counts are stale."
  );

  const help = spawnSync(process.execPath, [path.join(toolRoot, "dist", "cli.js"), "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert(help.status === 0, `Could not inspect ts2hx CLI help: ${help.stderr}`);
  const options = Array.from(help.stdout.matchAll(/^\s+(--[a-z0-9-]+)/gim), (match) => match[1] ?? "")
    .filter((option) => option.length > 0);
  for (const option of options)
    assert(usage.includes(option), `USAGE.md does not document CLI option ${option}.`);
  for (const command of ["--help", "--version"])
    assert(usage.includes(command), `USAGE.md does not document CLI command ${command}.`);

  for (const markdown of [
    architecturePath,
    architectureRoadmapPath,
    topWorkflowsPath,
    workflowsPath,
    limitationsPath,
    usagePath,
    portabilityPath,
    toolReadmePath
  ])
    validateLocalLinks(markdown);

  process.stdout.write(
    `ts2hx-docs:ok (${fixtures.length} fixtures, ${snapshotFiles.length} snapshots, ` +
    `${SEMANTIC_SUPPORT_MATRIX.length} semantic contracts, ${options.length} CLI options)\n`
  );
}

main();
