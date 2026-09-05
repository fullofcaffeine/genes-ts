import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const workflow = readFileSync(
  path.join(repoRoot, ".github/workflows/release-tooling.yml"),
  "utf8"
);
const ciWorkflow = readFileSync(
  path.join(repoRoot, ".github/workflows/ci.yml"),
  "utf8"
);
const compilerReleaseConfig = readFileSync(
  path.join(repoRoot, "release.config.cjs"),
  "utf8"
);
const environmentVerifier = path.join(
  repoRoot,
  "scripts/verify-tooling-release-environment.mjs"
);

type ActionPin = {
  owner: string;
  sha: string;
  version: string;
};

type ActionReference = ActionPin | { local: string };

const yamlModule: unknown = createRequire(import.meta.url)("js-yaml");
assert(
  typeof yamlModule === "object" &&
    yamlModule !== null &&
    "load" in yamlModule &&
    typeof yamlModule.load === "function",
  "js-yaml does not expose the required load function"
);
const parseYaml = yamlModule.load as (source: string) => unknown;

const toolingActionReferences: ActionReference[] = [
  {
    owner: "actions/checkout",
    sha: "d23441a48e516b6c34aea4fa41551a30e30af803",
    version: "v6.1.0",
  },
  {
    owner: "actions/setup-node",
    sha: "249970729cb0ef3589644e2896645e5dc5ba9c38",
    version: "v6.5.0",
  },
  { local: "./.github/actions/setup-yarn" },
  {
    owner: "actions/upload-artifact",
    sha: "ea165f8d65b6e75b540449e92b4886f43607fa02",
    version: "v4.6.2",
  },
];

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
 * Protects executable identity in workflows that can publish packages or
 * create compiler releases.
 *
 * A major-version action tag such as `@v6` can be moved after review, while a
 * full commit SHA identifies the exact action code that was approved. The
 * human-readable release comment remains on the same line so Dependabot can
 * propose reviewed SHA rotations without making the workflow opaque.
 */
function verifyPinnedActions(
  source: string,
  workflowName: string,
  expected: ActionReference[]
): void {
  const parsedUses: string[] = [];
  const visited = new WeakSet<object>();
  const collectUses = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) collectUses(item);
      return;
    }
    if (typeof value !== "object" || value === null || visited.has(value))
      return;

    visited.add(value);
    const record = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, "uses")) {
      assert(
        typeof record.uses === "string",
        `${workflowName} has a non-string uses: entry`
      );
      parsedUses.push(record.uses);
    }
    for (const [key, child] of Object.entries(record))
      if (key !== "uses") collectUses(child);
  };
  collectUses(parseYaml(source));

  const references = [...source.matchAll(
    /^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#\s+(\S+))?\s*$/gm
  )].map((match) => {
    const reference = match[1];
    if (reference.startsWith("./")) {
      return { reference, version: match[2] };
    }
    const separator = reference.lastIndexOf("@");
    assert(
      separator > 0,
      `${workflowName} action ${reference} is not an owner/repository reference pinned to a SHA`
    );
    return {
      reference,
      owner: reference.slice(0, separator),
      sha: reference.slice(separator + 1),
      version: match[2],
    };
  });

  assert(
    references.length === parsedUses.length,
    `${workflowName} has an unreviewed or non-canonical uses: entry`
  );
  assert(
    references.length === expected.length,
    `${workflowName} has an unexpected action reference`
  );
  for (let index = 0; index < references.length; index++) {
    const actual = references[index];
    const wanted = expected[index];
    assert(
      actual.reference === parsedUses[index],
      `${workflowName} action parsing disagrees with its canonical source line`
    );
    if ("local" in wanted) {
      assert(
        actual.reference === wanted.local && actual.version === undefined,
        `${workflowName} local action ${actual.reference} does not match reviewed ${wanted.local}`
      );
      continue;
    }
    assert(
      actual.sha !== undefined && /^[0-9a-f]{40}$/.test(actual.sha),
      `${workflowName} action ${actual.owner} is not pinned to a full commit SHA`
    );
    assert(
      actual.owner === wanted.owner &&
        actual.sha === wanted.sha &&
        actual.version === wanted.version,
      `${workflowName} action pin ${actual.owner}@${actual.sha} # ${actual.version ?? "missing"} ` +
        `does not match reviewed ${wanted.owner}@${wanted.sha} # ${wanted.version}`
    );
  }
}

type EnvironmentSnapshot = {
  name: string;
  can_admins_bypass: boolean;
  protection_rules: Array<{
    type: string;
    prevent_self_review?: boolean;
    reviewers?: Array<{ type: string; reviewer: { id: number } }>;
  }>;
  deployment_branch_policy: {
    protected_branches: boolean;
    custom_branch_policies: boolean;
  };
};

function runEnvironmentVerifier(
  arguments_: string[],
  expectedSuccess: boolean,
  message: string
): void {
  const result = spawnSync(process.execPath, [environmentVerifier, ...arguments_], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert(
    (result.status === 0) === expectedSuccess,
    `${message}\n${result.stdout}${result.stderr}`
  );
}

/**
 * Exercises the same environment-policy verifier used by the release job.
 *
 * Local mutation cases prove that each protection is independently required.
 * The final public API read proves that the GitHub setting still matches the
 * reviewed repository contract; a checked-in snapshot alone would miss live
 * settings drift.
 */
function verifyProtectedEnvironment(): void {
  const validPolicy = {
    schemaVersion: 1,
    repository: "fullofcaffeine/genes-ts",
    environment: "tooling-npm-production",
    minimumRequiredReviewers: 1,
    preventSelfReview: true,
    canAdminsBypass: false,
    protectedBranches: true,
    customBranchPolicies: false,
  };
  const valid: EnvironmentSnapshot = {
    name: "tooling-npm-production",
    can_admins_bypass: false,
    protection_rules: [
      {
        type: "required_reviewers",
        prevent_self_review: true,
        reviewers: [{ type: "User", reviewer: { id: 1 } }],
      },
      { type: "branch_policy" },
    ],
    deployment_branch_policy: {
      protected_branches: true,
      custom_branch_policies: false,
    },
  };
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "genes-release-environment-"));
  try {
    const snapshotPath = path.join(temporaryRoot, "environment.json");
    const policyPath = path.join(temporaryRoot, "policy.json");
    writeFileSync(policyPath, `${JSON.stringify(validPolicy)}\n`);
    const runSnapshot = (
      snapshot: EnvironmentSnapshot,
      expectedSuccess: boolean,
      message: string
    ): void => {
      writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`);
      runEnvironmentVerifier(["--file", snapshotPath], expectedSuccess, message);
    };

    runSnapshot(valid, true, "valid protected environment was rejected");
    runSnapshot(
      { ...valid, can_admins_bypass: true },
      false,
      "environment verifier accepted administrator bypass"
    );
    runSnapshot(
      {
        ...valid,
        protection_rules: valid.protection_rules.map((rule) =>
          rule.type === "required_reviewers"
            ? { ...rule, prevent_self_review: false }
            : rule
        ),
      },
      false,
      "environment verifier accepted self-review"
    );
    runSnapshot(
      {
        ...valid,
        protection_rules: valid.protection_rules.map((rule) =>
          rule.type === "required_reviewers" ? { ...rule, reviewers: [] } : rule
        ),
      },
      false,
      "environment verifier accepted an empty reviewer set"
    );
    runSnapshot(
      {
        ...valid,
        deployment_branch_policy: {
          protected_branches: false,
          custom_branch_policies: false,
        },
      },
      false,
      "environment verifier accepted unprotected deployment branches"
    );
    writeFileSync(
      policyPath,
      `${JSON.stringify({
        ...validPolicy,
        repository: "attacker-controlled/example",
      })}\n`
    );
    writeFileSync(snapshotPath, `${JSON.stringify(valid)}\n`);
    runEnvironmentVerifier(
      ["--file", snapshotPath, "--policy", policyPath],
      false,
      "environment verifier accepted policy for a different repository"
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }

  runEnvironmentVerifier(
    ["--live"],
    true,
    "live tooling-npm-production environment does not match checked-in policy"
  );
}

/**
 * Executes the repository's installed semantic-release analyzer with the
 * checked-in configuration.
 *
 * Merely checking that the tooling workflow lacks compiler-release commands is
 * not enough: `feat(tooling)` would otherwise be interpreted as a compiler
 * feature when the final same-CI semantic-release job reads main's
 * commit history. This probe verifies both halves of the boundary—tooling
 * commits are ignored by the compiler release line, while ordinary compiler
 * feature and fix commits retain the default SemVer behavior.
 */
function analyzeCompilerCommit(message: string): string {
  const program = `
    import { analyzeCommits } from "@semantic-release/commit-analyzer";
    import { createRequire } from "node:module";
    const require = createRequire(import.meta.url);
    const repoRoot = process.argv[1];
    const message = process.argv[2];
    const config = require(repoRoot + "/release.config.cjs");
    const analyzer = config.plugins.find(
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
    "ref: ${{ github.sha }}",
    "tooling release must check out the protected workflow ref, not an arbitrary commit input"
  );
  requireText(
    source,
    "environment: tooling-npm-production",
    "release job must use the protected production environment"
  );
  requireText(
    source,
    `- uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.1.0
        with:
          fetch-depth: 0
          ref: \${{ github.sha }}
      - name: Verify protected source before running repository code`,
    "protected source verification must be the immediate first step after checkout"
  );
  requireOrdered(
    source,
    "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.1.0",
    "Verify protected source before running repository code",
    "the checked-out commit must be verified before repository code runs"
  );
  requireOrdered(
    source,
    "Verify protected source before running repository code",
    "node scripts/verify-tooling-release-environment.mjs --live",
    "protected source must be proven before the checked-out verifier runs"
  );
  requireOrdered(
    source,
    "node scripts/verify-tooling-release-environment.mjs --live",
    "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6.5.0",
    "live approval policy must be checked before release toolchain setup"
  );
  requireText(
    source,
    'NPM_RELEASE_VERSION: "11.18.0"',
    "trusted publishing must use an explicit npm CLI version at or above 11.5.1"
  );
  requireText(
    source,
    'node-version: ${{ steps.toolchains.outputs.node-next-lts }}',
    "trusted publishing must use the repository's pinned latest Node 26 lane"
  );
  requireText(
    source,
    "package-manager-cache: false",
    "release setup must not restore an unreviewed package-manager cache"
  );
  requireText(
    source,
    "- uses: ./.github/actions/setup-yarn",
    "release must install the reviewed standalone Yarn CLI"
  );
  assert(
    !source.includes("corepack") && !/cache:\s*yarn/.test(source),
    "release must not rely on Node-bundled Corepack or pre-install Yarn caching"
  );
  requireOrdered(
    source,
    "- uses: ./.github/actions/setup-yarn",
    "- run: yarn install --frozen-lockfile",
    "standalone Yarn must be installed before the first Yarn command"
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
    source.split(remoteMainCheck).length - 1 === 3,
    "release commit must equal current remote main before repository code, before testing, and immediately before publication"
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
    "- uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2\n        if: ${{ always() }}",
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

function verifyProtectedCiOwner(source: string): void {
  const parsed: unknown = parseYaml(source);
  assert(typeof parsed === "object" && parsed !== null, "CI workflow must be a mapping");
  const workflowRecord = parsed as Record<string, unknown>;
  assert(
    typeof workflowRecord.jobs === "object" && workflowRecord.jobs !== null,
    "CI workflow must define jobs"
  );
  const jobs = workflowRecord.jobs as Record<string, unknown>;
  const preflightJob = jobs["genes-ts-preflight"];
  assert(
    typeof preflightJob === "object" && preflightJob !== null,
    "CI workflow must define the genes-ts preflight job"
  );
  const preflightJobRecord = preflightJob as Record<string, unknown>;
  assert(
    Array.isArray(preflightJobRecord.steps),
    "genes-ts preflight job must define steps"
  );
  assert(
    preflightJobRecord.steps.some(
      (step: unknown) =>
        typeof step === "object" &&
        step !== null &&
        (step as Record<string, unknown>).run ===
          "yarn test:tooling-release-workflow"
    ),
    "the genes-ts preflight must run the live release-policy owner"
  );
  const requiredJob = jobs["genes-ts"] as Record<string, unknown> | undefined;
  assert(
    Array.isArray(requiredJob?.needs)
      && requiredJob.needs.includes("genes-ts-preflight"),
    "the protected genes-ts aggregate must require the release-policy preflight"
  );
}

verifyPinnedActions(workflow, "tooling release workflow", toolingActionReferences);
verifyToolingReleaseWorkflow(workflow);
verifyProtectedEnvironment();
verifyProtectedCiOwner(ciWorkflow);
assert(
  !compilerReleaseConfig.includes("npm publish") &&
    !compilerReleaseConfig.includes("@genes-ts/tooling"),
  "compiler semantic-release configuration must not publish the tooling npm package"
);
assert(
  compilerReleaseConfig.includes('scope: "tooling"') &&
    compilerReleaseConfig.includes("release: false"),
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

rejected = false;
try {
  verifyPinnedActions(
    workflow.replace(
      "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.1.0",
      "actions/checkout@v6"
    ),
    "mutated tooling release workflow",
    toolingActionReferences
  );
} catch {
  rejected = true;
}
assert(rejected, "tooling release policy accepted a mutable action tag");

for (const unauthorizedUse of [
  "      - uses: ./unreviewed-local-action\n",
  "      - uses: docker://example.invalid/release-helper:latest\n",
  "      - { uses: ./unreviewed-inline-action }\n",
  "      - \"uses\": ./unreviewed-quoted-action\n",
]) {
  rejected = false;
  try {
    verifyPinnedActions(
      workflow.replace("    steps:\n", `    steps:\n${unauthorizedUse}`),
      "mutated tooling release workflow",
      toolingActionReferences
    );
  } catch {
    rejected = true;
  }
  assert(rejected, `tooling release policy accepted ${unauthorizedUse.trim()}`);
}

rejected = false;
try {
  verifyToolingReleaseWorkflow(
    workflow.replace(
      "      - name: Verify protected source before running repository code",
      "      - run: node scripts/unreviewed-before-source-proof.mjs\n" +
        "      - name: Verify protected source before running repository code"
    )
  );
} catch {
  rejected = true;
}
assert(rejected, "tooling release policy allowed repository code before source proof");

rejected = false;
try {
  verifyToolingReleaseWorkflow(
    workflow.replace(
      "ref: ${{ github.sha }}",
      "ref: ${{ inputs.commit }}"
    )
  );
} catch {
  rejected = true;
}
assert(rejected, "tooling release policy accepted repository code from an arbitrary commit input");

rejected = false;
try {
  const command = "      - run: yarn test:tooling-release-workflow\n";
  const withoutRequiredOwner = ciWorkflow.replace(command, "");
  verifyProtectedCiOwner(
    withoutRequiredOwner.replace("    steps:\n", `    steps:\n${command}`)
  );
} catch {
  rejected = true;
}
assert(
  rejected,
  "CI policy accepted the live release check only in a non-required job"
);

console.log(
  "tooling-release-workflow:ok (immutable actions + live independent approval + exact OIDC bytes)"
);
