import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function jobBlock(source: string, job: string, nextJob?: string): string {
  const end = nextJob ? `^  ${nextJob}:` : "$(?![\\s\\S])";
  const match = new RegExp(`^  ${job}:\\n([\\s\\S]*?)${end}`, "m").exec(source);
  assert(match != null, `CI workflow is missing the ${job} job`);
  return match[0];
}

/**
 * Protects the repository half of the live `main` ruleset contract.
 *
 * Why: GitHub can require a check only when every pull request creates that
 * check. A workflow-level path exclusion made roadmap-only Beads pull requests
 * skip the entire compiler workflow, so enabling the documented ruleset would
 * have left those changes permanently waiting for checks that could never run.
 *
 * What/How: this fast local gate keeps the ordinary pull-request and main
 * triggers unconditional, while allowing an independently validated schedule,
 * freezes the six status-check names configured in GitHub, and verifies that
 * preview Haxe and macOS remain advisory. It cannot prove remote repository
 * settings; maintainers compare those through the API commands in
 * `docs/BRANCH_PROTECTION.md`.
 */
function main(): void {
  const ci = read(".github/workflows/ci.yml");
  const docs = read("docs/BRANCH_PROTECTION.md");

  const triggerPrefix = `on:
  push:
    branches: [main]
  pull_request:`;
  assert(
    ci.startsWith(`name: genes-ts CI\n\n${triggerPrefix}\n`)
      && ci.includes("\n  workflow_dispatch:\n\nconcurrency:"),
    "Compiler CI must run for every pull request and main push; required checks cannot use path filters"
  );
  assert(
    !ci.includes("paths-ignore:") && !ci.includes("paths:"),
    "Required compiler checks must not be suppressed by workflow path filters"
  );

  for (const name of [
    "Secrets (gitleaks)",
    "Vulnerabilities (OSV)",
    "genes-ts (TS output + todoapp E2E)"
  ] as const) {
    assert(ci.includes(`name: ${name}`),
      `CI workflow changed required status-check name: ${name}`);
    assert(docs.includes(`\`${name}\``),
      `Branch-protection guide omits required status check: ${name}`);
  }
  for (const name of [
    "Classic Genes (stable, ubuntu-latest)",
    "Classic Genes (nextLts, ubuntu-latest)"
  ] as const)
    assert(docs.includes(`\`${name}\``),
      `Branch-protection guide omits required matrix check: ${name}`);

  assert(
    ci.includes("name: Classic Genes (${{ matrix.node-lane }}, ${{ matrix.os }})"),
    "CI workflow changed the required Classic Genes matrix check format"
  );
  assert(
    ci.includes("name: Analyze (JavaScript)") &&
      docs.includes("`Analyze (JavaScript)`"),
    "CI workflow or branch-protection guide changed the required Analyze (JavaScript) check"
  );

  const classic = jobBlock(ci, "classic", "genes-ts");
  const classicMatrix = `matrix:
        include:
          - os: ubuntu-latest
            node-lane: stable
          - os: ubuntu-latest
            node-lane: nextLts
          - os: macos-latest
            node-lane: stable
            allow-failure: true`;
  assert(
    classic.includes(classicMatrix),
    "Classic matrix must retain both required Ubuntu lanes and the advisory macOS lane"
  );
  assert(
    classic.includes("continue-on-error: ${{ matrix.allow-failure || false }}"),
    "Classic macOS allow-failure must remain connected to job-level continue-on-error"
  );
  const genesTs = jobBlock(ci, "genes-ts", "genes-ts-smoke-next-lts");
  assert(
    genesTs.includes("- run: yarn test:main-protection-policy"),
    "The required genes-ts job must execute the structural protection policy"
  );
  const toolingPack = genesTs.indexOf(
    "- name: Pack tooling for its oldest supported Node release"
  );
  const toolingMinimumNode = genesTs.indexOf("node-version: 26.1.0");
  const toolingMinimumCheck = genesTs.indexOf(
    "- name: Verify the packed tooling package on Node 26.1"
  );
  const toolingRestoreNode = genesTs.indexOf(
    "- name: Restore the repository Node release"
  );
  assert(
    toolingPack >= 0
      && toolingPack < toolingMinimumNode
      && toolingMinimumNode < toolingMinimumCheck
      && toolingMinimumCheck < toolingRestoreNode,
    "The required genes-ts job must pack tooling, check Node 26.1, and restore the repository Node release"
  );
  assert(
    genesTs.includes('--tarball "$TOOLING_MINIMUM_TARBALL"')
      && genesTs.includes('--pack-json "$TOOLING_MINIMUM_PACK_JSON"'),
    "The Node 26.1 check must inspect the exact packed tooling candidate"
  );
  for (const [job, nextJob] of [
    ["genes-ts", "genes-ts-smoke-next-lts"],
    ["genes-ts-smoke-next-lts", "haxe-preview"]
  ] as const) {
    const block = jobBlock(ci, job, nextJob);
    const haxeInstall =
      "- run: yarn lix install haxe ${{ steps.toolchains.outputs.haxe-stable }}";
    const haxeUse =
      "- run: yarn lix use haxe ${{ steps.toolchains.outputs.haxe-stable }}";
    const formatter = "- run: yarn haxelib install formatter 1.18.0 --quiet";
    const acceptance = "- run: yarn test:acceptance";
    const haxeInstallIndex = block.indexOf(haxeInstall);
    const haxeUseIndex = block.indexOf(haxeUse);
    const formatterIndex = block.indexOf(formatter);
    const acceptanceIndex = block.indexOf(acceptance);
    assert(
      haxeInstallIndex >= 0
        && haxeInstallIndex < haxeUseIndex
        && haxeUseIndex < formatterIndex
        && formatterIndex < acceptanceIndex,
      `${job} must select Haxe before installing the pinned formatter and running the stdlib-overlay acceptance gate`
    );
  }
  const preview = jobBlock(ci, "haxe-preview");
  assert(
    preview.includes("continue-on-error: true"),
    "Haxe preview must remain advisory until its compatibility lane is promoted"
  );

  for (const phrase of [
    "active repository ruleset",
    "Require a pull request",
    "Require status checks",
    "No bypass actors",
    "Roadmap-only pull requests"
  ])
    assert(docs.includes(phrase),
      `Branch-protection guide omits policy fact: ${phrase}`);

  console.log("main-protection-policy:ok (required checks always report; advisory lanes remain non-blocking)");
}

main();
