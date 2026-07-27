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
  requireText(
    source,
    "test \"$RELEASE_COMMIT\" = \"$(git rev-parse origin/main)\"",
    "release commit must equal the current remote main commit"
  );
  requireText(source, "run: yarn test:ci", "release must rerun the full repository gate");
  requireText(
    source,
    "node scripts/dist/test-tooling-package.js --tarball \"$tarball\"",
    "candidate tarball must pass a clean packed-consumer check"
  );
  requireOrdered(
    source,
    "Pack and independently verify candidate bytes",
    "npm publish \"${{ steps.local-package.outputs.tarball }}\"",
    "candidate verification must happen before publication"
  );
  requireText(source, "--provenance", "npm publication must produce provenance");
  requireText(
    source,
    "cmp \"${{ steps.local-package.outputs.tarball }}\" \"$downloaded\"",
    "downloaded registry bytes must equal the reviewed tarball"
  );
  requireOrdered(
    source,
    "npm publish \"${{ steps.local-package.outputs.tarball }}\"",
    "node scripts/dist/test-tooling-package.js --tarball \"$downloaded\"",
    "published bytes must be downloaded and independently consumed"
  );
  requireText(
    source,
    "create-tooling-release-evidence.js",
    "release must produce a deterministic receipt and SPDX SBOM"
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
    workflow.replace(
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
