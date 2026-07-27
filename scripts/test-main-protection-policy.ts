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
 * What/How: this fast local gate keeps the ordinary pull-request trigger
 * unconditional, freezes the six status-check names configured in GitHub, and
 * verifies that preview Haxe and macOS remain advisory. It cannot prove remote
 * repository settings; maintainers compare those through the API commands in
 * `docs/BRANCH_PROTECTION.md`.
 */
function main(): void {
  const ci = read(".github/workflows/ci.yml");
  const codeql = read(".github/workflows/codeql.yml");
  const docs = read("docs/BRANCH_PROTECTION.md");

  const trigger = `on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:`;
  assert(
    ci.startsWith(`name: genes-ts CI\n\n${trigger}\n`),
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
    codeql.includes("name: Analyze (JavaScript)") &&
      docs.includes("`Analyze (JavaScript)`"),
    "CodeQL workflow or branch-protection guide changed the required Analyze (JavaScript) check"
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
