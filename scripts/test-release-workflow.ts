import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);

type ReleasePlugin =
  | string
  | [string, Record<string, unknown>];
type ReleaseConfig = {
  branches: string[];
  tagFormat: string;
  plugins: ReleasePlugin[];
};

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function jobBlock(source: string, job: string): string {
  const match = new RegExp(`^  ${job}:\\n([\\s\\S]*)$`, "m").exec(source);
  assert(match, `CI workflow is missing final ${job} job`);
  return match[0];
}

function analyzeCommit(message: string): string {
  const program = `
    import { analyzeCommits } from "@semantic-release/commit-analyzer";
    import { createRequire } from "node:module";
    const require = createRequire(import.meta.url);
    const config = require(process.argv[1] + "/release.config.cjs");
    const analyzer = config.plugins.find(
      plugin => Array.isArray(plugin) &&
        plugin[0] === "@semantic-release/commit-analyzer"
    );
    if (!analyzer) throw new Error("configured commit analyzer was not found");
    const result = await analyzeCommits(analyzer[1], {
      commits: [{ hash: "1111111111111111111111111111111111111111", message: process.argv[2] }],
      cwd: process.argv[1],
      logger: { log() {} },
    });
    process.stdout.write(result ?? "none");
  `;
  return execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", program, repoRoot, message],
    { cwd: repoRoot, encoding: "utf8" }
  )
    .trim();
}

function generatedNotes(): string {
  const program = `
    import { createRequire } from "node:module";
    import { execFileSync } from "node:child_process";
    const require = createRequire(import.meta.url);
    const repoRoot = process.argv[1];
    const config = require(repoRoot + "/release.config.cjs");
    const plugin = config.plugins.find(
      entry => Array.isArray(entry) &&
        entry[0] === "./scripts/release/release-notes-plugin.cjs"
    );
    if (!plugin) throw new Error("release notes generator is not configured");
    const wrapper = require(repoRoot + "/scripts/release/release-notes-plugin.cjs");
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const notes = await wrapper.generateNotes(plugin[1], {
      cwd: repoRoot,
      commits: [
        {
          hash: head,
          message: "fix(release): preserve protected main",
        },
        {
          hash: "abcdef1234567890abcdef1234567890abcdef12",
          message: "docs: explain the release model",
        },
      ],
      lastRelease: {
        version: "1.39.0",
        gitTag: "v1.39.0",
        gitHead: "0000000000000000000000000000000000000000",
      },
      nextRelease: {
        version: "1.39.1",
        gitTag: "v1.39.1",
        gitHead: head,
      },
      options: {
        repositoryUrl: "https://github.com/fullofcaffeine/genes-ts.git",
        tagFormat: "v\${version}",
      },
      branch: { name: "main" },
      logger: { log() {}, error() {}, success() {} },
    });
    process.stdout.write(notes);
  `;
  return execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", program, repoRoot],
    { cwd: repoRoot, encoding: "utf8" }
  );
}

assert(
  !existsSync(path.join(repoRoot, ".github/workflows/release.yml")),
  "publication must not run in a detached workflow_run workflow"
);
const ci = read(".github/workflows/ci.yml");
assert.match(
  ci,
  /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}/
);
const release = jobBlock(ci, "release");
assert.match(
  release,
  /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/
);
for (const dependency of [
  "beads-worktree-safety",
  "beads-pinned-client",
  "codeql",
  "secrets",
  "vulns",
  "classic",
  "genes-ts",
  "genes-ts-smoke-next-lts",
]) {
  assert.match(release, new RegExp(`^      - ${dependency}$`, "m"));
}
const genesTs = /^  genes-ts:\n([\s\S]*?)^  genes-ts-smoke-next-lts:/m.exec(ci);
assert(genesTs, "CI workflow is missing the required genes-ts job");
assert.match(
  genesTs[1],
  /^\s+- run: yarn test:release$/m,
  "required hosted CI must exercise the release protocol before publication"
);
assert.match(release, /permissions:\n\s+contents: write/);
assert.doesNotMatch(release, /pull-requests: write|issues: write|write-all/);
assert.match(release, /group: release-\$\{\{ github\.repository \}\}/);
assert.match(release, /cancel-in-progress: false/);
assert.match(release, /ref: \$\{\{ github\.sha \}\}/);
assert.match(release, /fetch-depth: 0/);
assert.match(release, /RELEASE_SOURCE_SHA: \$\{\{ github\.sha \}\}/);
assert.match(release, /git tag --points-at HEAD/);
assert.doesNotMatch(
  release,
  /verify-host-controls/,
  "GITHUB_TOKEN cannot read Administration-scoped repository settings"
);
assert.match(release, /semantic_status=\$\?/);
assert.match(release, /node scripts\/release\/complete-release\.cjs "\$tag"/);
assert.match(
  release,
  /authoritative final Release reports immutable=true/,
  "workflow must explain how CI verifies immutability without an admin token"
);
assert.doesNotMatch(
  release,
  /workflow_run|workflow_dispatch|actions\/cache|upload-artifact|download-artifact|environment:/
);
for (const reference of release.matchAll(/uses:\s+([^\s#]+)/g)) {
  assert.match(reference[1], /@[0-9a-f]{40}$/);
}

const config = require(
  path.join(repoRoot, "release.config.cjs")
) as ReleaseConfig;
assert.deepEqual(config.branches, ["main"]);
assert.equal(config.tagFormat, "v${version}");
const pluginNames = config.plugins.map((plugin) =>
  Array.isArray(plugin) ? plugin[0] : plugin
);
assert.deepEqual(pluginNames, [
  "@semantic-release/commit-analyzer",
  "./scripts/release/release-notes-plugin.cjs",
  "./scripts/release/haxelib-artifact-plugin.cjs",
  "@semantic-release/github",
  "./scripts/release/published-verifier-plugin.cjs",
]);
for (const forbidden of [
  "@semantic-release/git",
  "@semantic-release/changelog",
  "@semantic-release/exec",
]) {
  assert(!pluginNames.includes(forbidden), `${forbidden} must not mutate main`);
}

const packageJson = JSON.parse(read("package.json")) as {
  version: string;
  release?: unknown;
  devDependencies: Record<string, string>;
};
const haxelib = JSON.parse(read("haxelib.json")) as {
  version: string;
  releasenote: string;
};
assert.equal(packageJson.version, "0.0.0-development");
assert.equal(packageJson.release, undefined);
assert.equal(haxelib.version, "0.0.0");
assert.equal(
  haxelib.releasenote,
  "Development checkout; release metadata is injected during package staging"
);
for (const [name, version] of Object.entries({
  "@semantic-release/commit-analyzer": "13.0.1",
  "@semantic-release/github": "12.0.9",
  "@semantic-release/release-notes-generator": "14.1.1",
  "conventional-changelog-conventionalcommits": "9.3.1",
  "semantic-release": "25.0.6",
  fflate: "0.8.3",
  semver: "7.8.5",
})) {
  assert.equal(
    packageJson.devDependencies[name],
    version,
    `${name} must remain exact-pinned as part of the release compatibility set`
  );
}

assert.equal(analyzeCommit("fix(ts): repair output"), "patch");
assert.equal(analyzeCommit("perf(es): reduce generated allocations"), "patch");
assert.equal(analyzeCommit("feat(ts): add output mode"), "minor");
assert.equal(
  analyzeCommit("feat(ts)!: remove a supported output contract"),
  "major"
);
assert.equal(analyzeCommit("docs: explain the output contract"), "none");
assert.equal(analyzeCommit("feat(tooling): add host helper"), "none");
assert.equal(
  analyzeCommit("feat(tooling)!: replace the host API"),
  "none",
  "breaking tooling changes belong to tooling's independent SemVer"
);
const notes = generatedNotes();
const headDate = execFileSync(
  "git",
  ["show", "-s", "--format=%cs", "HEAD"],
  { cwd: repoRoot, encoding: "utf8" }
).trim();
assert.match(notes, /### Bug Fixes/);
assert.match(notes, /preserve protected main/);
assert.match(
  notes,
  new RegExp(`^## .*\\(${headDate}\\)$`, "m"),
  "release notes must use the tested commit date rather than wall-clock time"
);
assert.doesNotMatch(notes, /explain the release model/);

console.log(
  "release-workflow:ok (same-run tested SHA; no release commit; conventional SemVer and notes verified)"
);
