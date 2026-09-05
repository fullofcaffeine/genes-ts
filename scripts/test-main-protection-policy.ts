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
  const todoQa = read("scripts/qa-todoapp.ts");
  const packageJson = JSON.parse(read("package.json")) as {
    readonly scripts?: Readonly<Record<string, string>>;
  };

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

  const classic = jobBlock(ci, "classic", "genes-ts-preflight");
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
  const preflight = jobBlock(ci, "genes-ts-preflight", "genes-ts-acceptance-shards");
  const shards = jobBlock(ci, "genes-ts-acceptance-shards", "genes-ts");
  const genesTs = jobBlock(ci, "genes-ts", "genes-ts-smoke-next-lts");
  assert(
    preflight.includes("- run: yarn test:main-protection-policy"),
    "The genes-ts preflight must execute the structural protection policy"
  );
  const toolingPack = preflight.indexOf(
    "- name: Pack tooling for its oldest supported Node release"
  );
  const yarnInstall = shards.indexOf("- run: yarn install --frozen-lockfile");
  const playwrightIdentity = shards.indexOf(
    "- name: Identify the pinned Playwright browser"
  );
  const playwrightCache = shards.indexOf("- name: Cache Playwright browsers");
  assert(
    yarnInstall >= 0
      && yarnInstall < playwrightIdentity
      && playwrightIdentity < playwrightCache,
    "The examples shard must install the pinned package before identifying and restoring its Playwright browser cache"
  );
  const playwrightCacheBlock = shards.slice(playwrightIdentity);
  assert(
    playwrightCacheBlock.includes('browser.name === "chromium"')
      && playwrightCacheBlock.includes("browser.installByDefault === true")
      && playwrightCacheBlock.includes("chromium.browserVersion")
      && playwrightCacheBlock.includes("chromium.revision"),
    "The Playwright cache identity must come from the pinned default Chromium metadata"
  );
  assert(
    playwrightCacheBlock.includes(
      "key: ${{ runner.os }}-${{ runner.arch }}-playwright-${{ steps.playwright-cache.outputs.identity }}"
    )
      && playwrightCacheBlock.includes(
        "${{ runner.os }}-${{ runner.arch }}-playwright-"
      )
      && playwrightCacheBlock.includes("${{ runner.os }}-playwright-")
      && !playwrightCacheBlock.includes("hashFiles('yarn.lock')"),
    "The Playwright browser cache must use its exact identity and retain the architecture and legacy restore prefixes"
  );
  assert(
    todoQa.includes('if (!skipPlaywrightInstall)')
      && todoQa.includes('if (process.env.CI) pwInstallArgs.push("--with-deps")')
      && todoQa.includes('pwInstallArgs.push("chromium")')
      && todoQa.includes('run("npx", ["playwright", ...pwInstallArgs])'),
    "Todoapp CI must still install the required Chromium revision after cache restore"
  );
  const toolingMinimumNode = preflight.indexOf("node-version: 26.1.0");
  const toolingMinimumCheck = preflight.indexOf(
    "- name: Verify the packed tooling package on Node 26.1"
  );
  const toolingRestoreNode = preflight.indexOf(
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
    preflight.includes('--tarball "$TOOLING_MINIMUM_TARBALL"')
      && preflight.includes('--pack-json "$TOOLING_MINIMUM_PACK_JSON"'),
    "The Node 26.1 check must inspect the exact packed tooling candidate"
  );
  for (const [job, nextJob] of [
    ["genes-ts-acceptance-shards", "genes-ts"],
    ["genes-ts-smoke-next-lts", "haxe-preview"]
  ] as const) {
    const block = jobBlock(ci, job, nextJob);
    const haxeInstall =
      "- run: yarn lix install haxe ${{ steps.toolchains.outputs.haxe-stable }}";
    const haxeUse =
      "- run: yarn lix use haxe ${{ steps.toolchains.outputs.haxe-stable }}";
    const formatter = "- run: yarn haxelib install formatter 1.18.0 --quiet";
    const acceptance = job === "genes-ts-acceptance-shards"
      ? "- run: yarn test:acceptance ${{ matrix.shard }}\n"
      : "- run: yarn test:acceptance\n";
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
  const ownerFixture = "run: yarn test:acceptance-process-owner";
  const fullLocalGate = packageJson.scripts?.["test:ci"];
  const fullLocalAcceptance =
    "cross-env SKIP_CLASSIC=1 SKIP_TS2HX=1 yarn test:acceptance";
  assert(
    typeof fullLocalGate === "string"
      && fullLocalGate.includes("yarn test:acceptance-process-owner")
      && fullLocalGate.indexOf("yarn test:acceptance-process-owner")
        < fullLocalGate.indexOf(fullLocalAcceptance),
    "The full local gate must run the process-owner fixture outside and before acceptance"
  );
  assert(
    preflight.includes(ownerFixture),
    "The genes-ts preflight must run the process-owner fixture outside acceptance shards"
  );
  assert(
    preflight.includes(
      "run: yarn test:acceptance-process-owner\n        timeout-minutes: 5"
    )
      && preflight.includes("steps.acceptance-process-owner.outcome != 'skipped'")
      && preflight.includes("name: genes-acceptance-process-owner")
      && preflight.includes("path: .tmp/test-acceptance-process-owner")
      && preflight.includes("if-no-files-found: warn"),
    "The required process-owner fixture must retain its workflow backstop"
  );
  assert(
    shards.includes("fail-fast: false")
      && shards.includes("shard: [compiler, react, output, focused-examples]")
      && shards.includes("timeout-minutes: 20")
      && shards.includes("- run: yarn test:acceptance ${{ matrix.shard }}")
      && shards.includes('GENES_ACCEPTANCE_TIMEOUT_MS: "900000"')
      && shards.includes("name: genes-acceptance-shard-${{ matrix.shard }}")
      && shards.includes("if-no-files-found: error"),
    "Stable acceptance must keep four bounded non-fail-fast shards with exact evidence"
  );
  assert(
    genesTs.includes("name: genes-ts (TS output + todoapp E2E)")
      && genesTs.includes("needs: [genes-ts-preflight, genes-ts-acceptance-shards]")
      && genesTs.includes("if: ${{ always() }}")
      && genesTs.includes('--preflight-result "${{ needs.genes-ts-preflight.result }}"')
      && genesTs.includes('--shards-result "${{ needs.genes-ts-acceptance-shards.result }}"')
      && genesTs.includes("pattern: genes-acceptance-shard-*")
      && genesTs.includes("test-acceptance-shard-aggregate.js"),
    "The protected genes-ts check must always aggregate preflight and exact shard evidence"
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
