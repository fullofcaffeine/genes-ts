import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const workflow = readFileSync(
  path.join(repoRoot, ".github/workflows/release-tooling.yml"),
  "utf8"
);
const compilerWorkflow = readFileSync(
  path.join(repoRoot, ".github/workflows/release.yml"),
  "utf8"
);
const rootPackageJson = readFileSync(path.join(repoRoot, "package.json"), "utf8");

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requireText(source: string, text: string, message: string): void {
  assert(source.includes(text), message);
}

function requireOrdered(
  source: string,
  before: string,
  after: string,
  message: string
): void {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);
  assert(
    beforeIndex >= 0 && afterIndex > beforeIndex,
    message
  );
}

/**
 * Executes the repository's installed semantic-release analyzer with the
 * checked-in configuration.
 *
 * Merely checking that the tooling workflow lacks compiler-release commands is
 * not enough: `feat(tooling)` would otherwise be interpreted as a compiler
 * feature when the normal post-CI semantic-release workflow reads main's
 * commit history. This probe verifies both halves of the boundary—tooling
 * commits are ignored by the compiler release line, while ordinary compiler
 * feature and fix commits retain the default SemVer behavior.
 */
function analyzeCompilerCommit(message: string): string {
  const program = `
    import { readFileSync } from "node:fs";
    import { analyzeCommits } from "@semantic-release/commit-analyzer";
    const repoRoot = process.argv[1];
    const message = process.argv[2];
    const pkg = JSON.parse(readFileSync(repoRoot + "/package.json", "utf8"));
    const analyzer = pkg.release.plugins.find(
      (plugin) => Array.isArray(plugin) &&
        plugin[0] === "@semantic-release/commit-analyzer"
    );
    if (!analyzer) throw new Error("configured commit analyzer was not found");
    const result = await analyzeCommits(analyzer[1], {
      commits: [{ hash: "1111111111111111111111111111111111111111", message }],
      cwd: repoRoot,
      logger: { log() {} },
    });
    process.stdout.write(result ?? "none");
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", program, repoRoot, message],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  assert(
    result.status === 0,
    `semantic-release analysis failed for ${JSON.stringify(message)}\n${result.stdout}${result.stderr}`
  );
  return result.stdout;
}

/**
 * Protects the independent npm publication boundary for framework-neutral
 * host tooling.
 *
 * The workflow must remain manually authorized, main-pinned, OIDC-based, and
 * byte-oriented. A compiler semantic-release run must never publish tooling,
 * and merging ordinary code must never trigger an npm publication.
 */
function verifyToolingReleaseWorkflow(source: string): void {
  requireText(
    source,
    "on:\n  workflow_dispatch:\n    inputs:",
    "tooling publication must be workflow_dispatch-only"
  );
  for (const forbiddenTrigger of [
    "workflow_run:",
    "push:",
    "pull_request:",
    "schedule:",
  ]) {
    assert(
      !source.includes(forbiddenTrigger),
      `tooling publication must not use ${forbiddenTrigger}`
    );
  }
  requireText(source, "  contents: read\n  id-token: write", "release needs only read contents plus npm provenance OIDC");
  assert(!source.includes("contents: write"), "tooling release must not create tags or GitHub releases");
  assert(!source.includes("NPM_TOKEN"), "tooling release must use npm trusted publishing, not a repository token");
  requireText(
    source,
    "if: github.ref == 'refs/heads/main'",
    "release job must reject non-main workflow refs"
  );
  requireText(
    source,
    "environment: tooling-npm-production",
    "release job must use the protected production environment"
  );
  requireText(
    source,
    'NPM_RELEASE_VERSION: "11.18.0"',
    "trusted publishing must use an explicit npm CLI version at or above 11.5.1"
  );
  requireText(
    source,
    'node-version: ${{ steps.toolchains.outputs.node-next-lts }}',
    "trusted publishing must use the repository's pinned Node 24 lane"
  );
  requireText(
    source,
    "package-manager-cache: false",
    "release setup must not restore an unreviewed package-manager cache"
  );
  requireText(
    source,
    'test "$(npm view "npm@${NPM_RELEASE_VERSION}" dist.integrity)" = \\\n            "$NPM_RELEASE_INTEGRITY"',
    "release must verify the pinned npm CLI integrity before installation"
  );
  requireText(
    source,
    "expected=\"publish @genes-ts/tooling@${RELEASE_VERSION} from ${RELEASE_COMMIT}\"",
    "release must require the exact human authorization phrase"
  );
  const remoteMainCheck =
    "test \"$RELEASE_COMMIT\" = \"$(git rev-parse origin/main)\"";
  assert(
    source.split(remoteMainCheck).length - 1 === 2,
    "release commit must equal current remote main both before testing and immediately before publication"
  );
  requireText(source, "run: yarn test:ci", "release must rerun the full repository gate");
  requireText(
    source,
    "node scripts/dist/test-tooling-package.js \\\n            --tarball \"$tarball\" \\\n            --pack-json \"${RUNNER_TEMP}/tooling-local-pack.json\"",
    "the exact candidate tarball and its npm pack metadata must pass inventory, integrity, and clean-consumer checks"
  );
  requireOrdered(
    source,
    "run: yarn test:ci",
    "yarn --cwd tooling build",
    "the candidate must be rebuilt from reviewed source after the full gate"
  );
  requireOrdered(
    source,
    "yarn --cwd tooling build",
    "npm pack ./tooling --json",
    "candidate packing must follow the final tooling build"
  );
  requireOrdered(
    source,
    "Pack and independently verify candidate bytes",
    "npm publish \"${{ steps.local-package.outputs.tarball }}\"",
    "candidate verification must happen before publication"
  );
  requireText(source, "--provenance", "npm publication must produce provenance");
  requireOrdered(
    source,
    "Revalidate main and clean candidate immediately before publication",
    "Publish exact reviewed tarball with npm provenance",
    "remote-main and clean-tree checks must be repeated after the long release gates"
  );
  requireText(
    source,
    "cmp \"${{ steps.local-package.outputs.tarball }}\" \"$downloaded\"",
    "downloaded registry bytes must equal the reviewed tarball"
  );
  requireOrdered(
    source,
    "npm publish \"${{ steps.local-package.outputs.tarball }}\"",
    "--tarball \"$downloaded\"",
    "published bytes must be downloaded and independently consumed"
  );
  requireText(
    source,
    "if: ${{ always() && steps.publish.outcome != 'skipped' }}",
    "registry evidence must be attempted even when npm publish reports failure"
  );
  requireOrdered(
    source,
    "npm-publish.log",
    "registry-status.txt",
    "the workflow must retain publish output before recording registry state"
  );
  requireOrdered(
    source,
    'registry-view-exit-code=%s',
    "registry-byte-comparison.log",
    "registry metadata and its exit status must be retained before byte verification"
  );
  requireText(
    source,
    "create-tooling-release-evidence.js",
    "release must produce a deterministic receipt and SPDX SBOM"
  );
  requireText(
    source,
    "- uses: actions/upload-artifact@v4\n        if: ${{ always() }}",
    "release evidence must still upload when publication or registry verification fails"
  );
  for (const forbiddenAction of [
    "semantic-release",
    "haxelib",
    "git tag",
    "gh release",
  ]) {
    assert(
      !source.includes(forbiddenAction),
      `tooling release must not invoke compiler release action: ${forbiddenAction}`
    );
  }
}

verifyToolingReleaseWorkflow(workflow);
assert(
  !compilerWorkflow.includes("npm publish") &&
    !compilerWorkflow.includes("@genes-ts/tooling"),
  "compiler semantic-release workflow must not publish the tooling npm package"
);
assert(
  rootPackageJson.includes('"scope": "tooling"') &&
    rootPackageJson.includes('"release": false'),
  "compiler semantic-release must explicitly ignore tooling-scoped commits"
);
for (const toolingCommit of [
  "feat(tooling): add a host integration",
  "fix(tooling): correct package verification",
  "feat(tooling)!: replace a tooling protocol",
]) {
  assert(
    analyzeCompilerCommit(toolingCommit) === "none",
    `${toolingCommit} would incorrectly release the compiler`
  );
}
assert(
  analyzeCompilerCommit("feat(compiler): add a language feature") === "minor",
  "ordinary compiler features must still produce a minor release"
);
assert(
  analyzeCompilerCommit("fix(compiler): correct generated output") === "patch",
  "ordinary compiler fixes must still produce a patch release"
);

let rejected = false;
try {
  verifyToolingReleaseWorkflow(
    workflow.replace("on:\n  workflow_dispatch:", "on:\n  push:\n  workflow_dispatch:")
  );
} catch {
  rejected = true;
}
assert(rejected, "tooling release policy accepted an automatic push trigger");

rejected = false;
try {
  verifyToolingReleaseWorkflow(
    workflow.replaceAll(
      "test \"$RELEASE_COMMIT\" = \"$(git rev-parse origin/main)\"",
      "echo \"skip remote-main verification\""
    )
  );
} catch {
  rejected = true;
}
assert(rejected, "tooling release policy accepted an unpinned source commit");

console.log(
  "tooling-release-workflow:ok (manual main-pinned OIDC publish + exact downloaded-byte verification)"
);
