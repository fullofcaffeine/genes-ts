import { readFileSync } from "node:fs";
import path from "node:path";
import { acceptanceGateManifest } from "./acceptance-gate-manifest.js";

/**
 * Focused compiler contracts that acceptance, rather than an outer CI wrapper,
 * owns.
 *
 * Why: these tests previously ran only from the release-oriented `test:ci`
 * command. Stable pull-request shards call `test:acceptance <shard>` from the
 * same manifest, so regressions in focused compiler contracts cannot reach
 * main before their direct tests run.
 *
 * What/How: `test-acceptance.ts` executes this list exactly once. The
 * validation below rejects a second direct invocation from `test:ci` or either
 * GitHub workflow. Standalone focused commands remain available for iteration.
 */
export const acceptanceOwnedFocusedGates = acceptanceGateManifest.flatMap((gate) =>
  gate.focusedPackageScript === undefined ? [] : [{
    packageScript: gate.focusedPackageScript,
    compiledScript: gate.args[0] ?? "",
    ...(gate.requiresCompilerServer ? { requiresCompilerServer: true } : {})
  }]);

export function shouldRunAcceptanceFocusedGate(
  gate: (typeof acceptanceOwnedFocusedGates)[number],
  skipCompilerServer: boolean
): boolean {
  return !("requiresCompilerServer" in gate
    && gate.requiresCompilerServer
    && skipCompilerServer);
}

function directInvocation(source: string, packageScript: string): string | undefined {
  return [
    `yarn ${packageScript}`,
    `yarn run ${packageScript}`,
    `npm run ${packageScript}`,
    `pnpm ${packageScript}`,
    `pnpm run ${packageScript}`
  ].find((candidate) => source.includes(candidate));
}

/**
 * Rejects CI wiring that executes an acceptance-owned focused gate twice.
 *
 * The check deliberately covers only direct invocations. Aggregate commands
 * remain free to compose other suites; acceptance is the documented owner for
 * the audited entries above, and a duplicate direct command is the regression
 * this checkpoint found.
 */
export function assertFocusedGateOwnership(repoRoot: string): void {
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8")
  ) as { scripts?: Record<string, string> };
  const sources = [
    {
      label: "test:ci",
      source: packageJson.scripts?.["test:ci"] ?? ""
    },
    ...[
      ".github/workflows/ci.yml",
      ".github/workflows/release-tooling.yml"
    ].map((relativePath) => ({
      label: relativePath,
      source: readFileSync(path.join(repoRoot, relativePath), "utf8")
    }))
  ];

  const seen = new Set<string>();
  for (const gate of acceptanceOwnedFocusedGates) {
    if (seen.has(gate.compiledScript)) {
      throw new Error(`Acceptance focused gate is listed twice: ${gate.compiledScript}`);
    }
    seen.add(gate.compiledScript);

    for (const owner of sources) {
      const duplicate = directInvocation(owner.source, gate.packageScript);
      if (duplicate !== undefined) {
        throw new Error(
          `${gate.packageScript} is owned by test:acceptance and must not also run directly from ${owner.label}: ${duplicate}`
        );
      }
    }
  }
}
