import {createHash} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { acceptanceOwnedFocusedGates } from "./acceptance-gate-ownership.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const manifestPath = path.join(
  repoRoot,
  "tests",
  "testing-strategy",
  "agent-test-routing.json"
);

const validAxes = new Set([
  "genes-product",
  "portable-haxe",
  "repository-policy",
  "migration-tool"
]);
const validProfiles = new Set([
  "classic-esm",
  "classic-dts",
  "typescript",
  "tsx",
  "jsx",
  "ts2hx",
  "repository"
]);
const validTiers = new Set([
  "focused",
  "focused-aggregate",
  "acceptance",
  "full-release"
]);
const validCosts = new Set(["fast", "medium", "slow", "full"]);
const validRings = new Set(["R0", "R1", "R2", "R3", "R4", "R5"]);
const validSizes = new Set(["small", "medium", "large"]);
const validCacheModes = new Set([
  "cold",
  "required-clean",
  "warm-allowed",
  "not-applicable"
]);
const validEvidence = new Set([
  "haxe-compile",
  "generated-source",
  "target-typecheck",
  "runtime",
  "declarations",
  "source-map",
  "transaction",
  "determinism",
  "compiler-server",
  "browser-e2e",
  "policy",
  "security",
  "package-shape",
  "differential"
]);
const validRemoteJobs = new Set([
  "genes-test-plan-and-smoke",
  "genes-ts",
  "release"
]);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert(typeof value === "object" && value !== null && !Array.isArray(value),
    `${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  assert(typeof value === "string" && value.trim().length > 0,
    `${label} must be a non-empty string`);
  return value;
}

function stringArray(value: unknown, label: string, allowEmpty = false): string[] {
  assert(Array.isArray(value), `${label} must be an array`);
  const result = value.map((entry, index) => text(entry, `${label}[${index}]`));
  assert(allowEmpty || result.length > 0, `${label} must not be empty`);
  return result;
}

function unique(values: ReadonlyArray<string>, label: string): void {
  assert(new Set(values).size === values.length, `${label} contains duplicates`);
}

function enumValues(
  values: ReadonlyArray<string>,
  allowed: ReadonlySet<string>,
  label: string
): void {
  for (const value of values)
    assert(allowed.has(value), `${label} contains unsupported value: ${value}`);
}

function jobBlock(source: string, job: string, nextJob: string): string {
  const match = new RegExp(
    `^  ${job}:\\n([\\s\\S]*?)^  ${nextJob}:`,
    "m"
  ).exec(source);
  assert(match !== null, `CI workflow is missing the ${job} job`);
  return match[0];
}

function ownerRoot(owner: string): string {
  const wildcard = owner.search(/[*?[\]{}]/);
  const prefix = wildcard === -1 ? owner : owner.slice(0, wildcard);
  return prefix.replace(/\/+$/, "") || ".";
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * Keeps the agent-facing routing table tied to executable repository facts.
 *
 * Why: Genes already has many focused tests. The practical failure is choosing
 * a plausible command that proves only source shape, then treating it as
 * runtime, declaration, cross-profile, or release evidence. A prose-only table
 * can also retain a renamed script long after the real test moved.
 *
 * What/How: this check validates the small routing schema, confirms every
 * runnable entry has a package-script owner and existing evidence paths, and
 * requires every route to end at the repository's actual acceptance or full
 * gate. It does not execute those tests or replace their specialized runners.
 */
function main(): void {
  const manifest = record(
    JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
    "agent test-routing manifest"
  );
  assert(manifest.schemaVersion === 2, "Unsupported agent test-routing schema");
  assert(manifest.contract === "genes-agent-test-routing",
    "Unexpected agent test-routing contract");
  text(manifest.statement, "manifest.statement");

  const packageJson = record(
    JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as unknown,
    "package.json"
  );
  const packageScripts = record(packageJson.scripts, "package.json.scripts");

  const axes = (manifest.evidenceAxes as unknown[] | undefined) ?? [];
  assert(Array.isArray(axes) && axes.length === validAxes.size,
    "Manifest must define every evidence axis exactly once");
  const axisIds = axes.map((entry, index) => {
    const axis = record(entry, `evidenceAxes[${index}]`);
    text(axis.meaning, `evidenceAxes[${index}].meaning`);
    return text(axis.id, `evidenceAxes[${index}].id`);
  });
  unique(axisIds, "evidence axis IDs");
  enumValues(axisIds, validAxes, "evidence axis IDs");

  const gateEntries = manifest.gates;
  assert(Array.isArray(gateEntries) && gateEntries.length > 0,
    "Manifest must contain runnable gates");
  const gateIds: string[] = [];
  const gatesById = new Map<string, Record<string, unknown>>();
  for (const [index, entry] of gateEntries.entries()) {
    const gate = record(entry, `gates[${index}]`);
    const id = text(gate.id, `gates[${index}].id`);
    const packageScript = text(gate.packageScript, `gates[${index}].packageScript`);
    const packageCommand = packageScripts[packageScript];
    assert(typeof packageCommand === "string",
      `${id} references missing package script: ${packageScript}`);
    const runnerTokens = gate.runnerTokens === undefined
      ? [text(gate.runnerToken, `${id}.runnerToken`)]
      : stringArray(gate.runnerTokens, `${id}.runnerTokens`);
    unique(runnerTokens, `${id}.runnerTokens`);
    for (const runnerToken of runnerTokens)
      assert(packageCommand.includes(runnerToken),
        `${id} package script ${packageScript} no longer invokes ${runnerToken}`);
    const arguments_ = gate.arguments === undefined
      ? []
      : stringArray(gate.arguments, `${id}.arguments`);

    const tier = text(gate.tier, `${id}.tier`);
    const cost = text(gate.cost, `${id}.cost`);
    assert(validTiers.has(tier), `${id} has unsupported tier: ${tier}`);
    assert(validCosts.has(cost), `${id} has unsupported cost: ${cost}`);
    const gateAxes = stringArray(gate.axes, `${id}.axes`);
    enumValues(gateAxes, validAxes, `${id}.axes`);
    if (gateAxes.includes("portable-haxe"))
      assert([
        "portable-haxe-smoke",
        "portable-haxe-failure-propagation"
      ].includes(id), `${id} has no reviewed portable-Haxe evidence owner`);
    enumValues(stringArray(gate.profiles, `${id}.profiles`), validProfiles,
      `${id}.profiles`);
    enumValues(stringArray(gate.evidence, `${id}.evidence`), validEvidence,
      `${id}.evidence`);
    const ownerPaths = stringArray(gate.ownerPaths, `${id}.ownerPaths`);
    const owners = stringArray(gate.owners, `${id}.owners`);
    assert(JSON.stringify(owners) === JSON.stringify(ownerPaths),
      `${id}.owners must preserve its reviewed ownerPaths during schema migration`);
    for (const ownerPath of owners) {
      const root = ownerRoot(ownerPath);
      assert(existsSync(path.join(repoRoot, root)),
        `${id} references missing owner root: ${ownerPath}`);
    }
    for (const runnerToken of runnerTokens) {
      if (!runnerToken.startsWith("scripts/dist/")
        || !runnerToken.endsWith(".js")) continue;
      const source = runnerToken
        .replace(/^scripts\/dist\//, "scripts/")
        .replace(/\.js$/, ".ts");
      assert(owners.includes(source),
        `${id} runner ${runnerToken} is missing source owner ${source}`);
    }
    stringArray(gate.families, `${id}.families`);
    stringArray(gate.capabilities, `${id}.capabilities`);
    assert(validRings.has(text(gate.ring, `${id}.ring`)),
      `${id} has an unsupported feedback ring`);
    assert(validSizes.has(text(gate.size, `${id}.size`)),
      `${id} has an unsupported size`);
    assert(typeof gate.alwaysRun === "boolean", `${id}.alwaysRun must be boolean`);
    assert(Number.isInteger(gate.timeoutSeconds)
      && Number(gate.timeoutSeconds) > 0,
    `${id}.timeoutSeconds must be a positive integer`);
    assert(gate.historicalDurationMs === null
      || (typeof gate.historicalDurationMs === "number"
        && gate.historicalDurationMs >= 0),
    `${id}.historicalDurationMs must be null or non-negative`);
    assert(validCacheModes.has(text(gate.cacheMode, `${id}.cacheMode`)),
      `${id} has an unsupported cache mode`);
    assert(gate.command === [
      "yarn",
      packageScript,
      ...arguments_
    ].join(" "),
      `${id}.command must remain locally reproducible from its package script`);
    stringArray(gate.artifacts, `${id}.artifacts`);
    const remoteJobs = stringArray(gate.remoteJobs, `${id}.remoteJobs`);
    enumValues(remoteJobs, validRemoteJobs, `${id}.remoteJobs`);
    text(gate.proves, `${id}.proves`);
    text(gate.doesNotProve, `${id}.doesNotProve`);

    gateIds.push(id);
    gatesById.set(id, gate);
  }
  unique(gateIds, "gate IDs");
  assert(gatesById.get("acceptance")?.tier === "acceptance",
    "The acceptance gate must retain the acceptance tier");
  assert(gatesById.get("full-ci")?.tier === "full-release",
    "The full-ci gate must retain the full-release tier");
  const agentGuideOwners = stringArray(
    gatesById.get("agent-guides")?.owners,
    "agent-guides.owners"
  );
  for (const guide of [
    "AGENTS.md",
    "src/genes/AGENTS.md",
    "tools/ts2hx/AGENTS.md",
    "docs/README.md",
    "docs/TESTING_STRATEGY.md",
    "readme.md",
    "CONTRIBUTING.md"
  ])
    assert(agentGuideOwners.includes(guide),
      `agent-guides does not own validated guide: ${guide}`);

  const routeEntries = manifest.routes;
  assert(Array.isArray(routeEntries) && routeEntries.length > 0,
    "Manifest must contain change-area routes");
  const routeIds: string[] = [];
  const referencedGates = new Set<string>();
  for (const [index, entry] of routeEntries.entries()) {
    const route = record(entry, `routes[${index}]`);
    const id = text(route.id, `routes[${index}].id`);
    text(route.changeArea, `${id}.changeArea`);
    const focusedChoiceEntries = route.focusedChoices;
    assert(Array.isArray(focusedChoiceEntries) && focusedChoiceEntries.length > 0,
      `${id}.focusedChoices must not be empty`);
    const focusedChoices = focusedChoiceEntries.map((entry, choiceIndex) => {
      const choice = record(entry, `${id}.focusedChoices[${choiceIndex}]`);
      text(choice.when, `${id}.focusedChoices[${choiceIndex}].when`);
      return text(choice.gate, `${id}.focusedChoices[${choiceIndex}].gate`);
    });
    unique(focusedChoices, `${id}.focusedChoices`);
    const then = stringArray(route.then, `${id}.then`, true);
    const finishWith = stringArray(route.finishWith, `${id}.finishWith`);
    stringArray(route.inspect, `${id}.inspect`);
    stringArray(route.escalateWhen, `${id}.escalateWhen`);

    for (const gateId of [...focusedChoices, ...then, ...finishWith]) {
      assert(gatesById.has(gateId), `${id} references unknown gate: ${gateId}`);
      referencedGates.add(gateId);
    }
    assert(
      focusedChoices.every((gateId) =>
        ["focused", "focused-aggregate"].includes(
          String(gatesById.get(gateId)?.tier)
        )
      ),
      `${id} choices must be focused gates or bounded focused aggregates`
    );
    assert(finishWith.includes("full-ci"),
      `${id} must finish with full-ci before merge`);
    routeIds.push(id);
  }
  unique(routeIds, "route IDs");
  for (const gateId of gateIds)
    assert(referencedGates.has(gateId),
      `Runnable gate is not reachable from any change-area route: ${gateId}`);
  for (const acceptanceGate of acceptanceOwnedFocusedGates) {
    const catalogGate = gateEntries
      .map((entry, index) => record(entry, `gates[${index}]`))
      .find((gate) => gate.packageScript === acceptanceGate.packageScript);
    assert(catalogGate !== undefined,
      `Acceptance-owned focused gate is missing from the routing catalog: ${acceptanceGate.packageScript}`);
    const catalogGateId = text(
      catalogGate.id,
      `${acceptanceGate.packageScript}.catalogGateId`
    );
    assert(referencedGates.has(catalogGateId),
      `Acceptance-owned focused gate is not reachable from a change route: ${acceptanceGate.packageScript}`);
    const tokens = catalogGate.runnerTokens === undefined
      ? [text(catalogGate.runnerToken, `${catalogGateId}.runnerToken`)]
      : stringArray(catalogGate.runnerTokens, `${catalogGateId}.runnerTokens`);
    assert(tokens.includes(acceptanceGate.compiledScript),
      `${catalogGateId} does not record its acceptance-owned runner: ${acceptanceGate.compiledScript}`);
  }

  const impactRules = manifest.impactRules;
  assert(Array.isArray(impactRules) && impactRules.length > 0,
    "Manifest must contain deterministic impact rules");
  const impactRuleIds: string[] = [];
  const validExpansions = new Set([
    "affected",
    "affected-extended",
    "docs-only",
    "full"
  ]);
  for (const [index, entry] of impactRules.entries()) {
    const rule = record(entry, `impactRules[${index}]`);
    const id = text(rule.id, `impactRules[${index}].id`);
    stringArray(rule.patterns, `${id}.patterns`);
    const selected = stringArray(rule.selects, `${id}.selects`);
    for (const gateId of selected)
      assert(gatesById.has(gateId), `${id} selects unknown gate: ${gateId}`);
    text(rule.reason, `${id}.reason`);
    assert(validExpansions.has(text(rule.expansion, `${id}.expansion`)),
      `${id} has unsupported expansion`);
    impactRuleIds.push(id);
  }
  unique(impactRuleIds, "impact rule IDs");

  const selectionPolicy = record(
    manifest.selectionPolicy,
    "selectionPolicy"
  );
  assert(selectionPolicy.mode === "observation",
    "Affected selection must remain observation-only until audited");
  assert(selectionPolicy.unknownPath === "full",
    "Unknown paths must expand to full");
  assert(selectionPolicy.ambiguousOwnership === "full",
    "Ambiguous ownership must expand to full");
  assert(selectionPolicy.currentRequiredBackstop === "full-ci",
    "The existing full gate must remain authoritative during observation");
  assert(gatesById.get("portable-haxe-smoke")?.alwaysRun === true,
    "Portable Haxe smoke must remain an always-run non-docs sentinel");
  assert(gatesById.get("portable-haxe-failure-propagation")?.alwaysRun === true,
    "Failure propagation must remain an always-run non-docs sentinel");
  assert(gatesById.get("test-plan-validation")?.alwaysRun === true,
    "Plan validation must remain an always-run non-docs sentinel");

  const planned = record(
    manifest.plannedPortableHaxeEvidence,
    "plannedPortableHaxeEvidence"
  );
  assert(planned.status === "smoke-implemented",
    "Portable Haxe evidence status must match the implemented smoke boundary");
  assert(
    planned.haxeRevision === "e0b355c6be312c1b17382603f018cf52522ec651",
    "Official Haxe evidence revision drifted without a reviewed manifest update"
  );
  assert(
    planned.utestRevision === "a94f8812e8786f2b5fec52ce9f26927591d26327",
    "Official utest evidence revision drifted without a reviewed manifest update"
  );
  const stages = planned.stages;
  assert(Array.isArray(stages) && stages.length === 4,
    "Portable Haxe rollout must retain inventory, smoke, representative, and scheduled/release stages");
  const expectedStages = [
    ["inventory", "genes-brxy.1"],
    ["smoke", "genes-brxy.2"],
    ["representative-expansion", "genes-brxy.3"],
    ["scheduled-release-expansion", "genes-brxy.5"]
  ] as const;
  for (const [index, entry] of stages.entries()) {
    const stage = record(entry, `plannedPortableHaxeEvidence.stages[${index}]`);
    assert(stage.id === expectedStages[index]?.[0],
      `Portable Haxe stage ${index} identity drifted: expected ${expectedStages[index]?.[0]}`);
    assert(stage.bead === expectedStages[index]?.[1],
      `Portable Haxe stage ${index} owner drifted: expected ${expectedStages[index]?.[1]}`);
    text(stage.outcome, `planned portable stage ${index}.outcome`);
  }
  const portableManifest = record(JSON.parse(readFileSync(
    path.join(repoRoot, "tests", "portable-haxe-smoke", "manifest.json"),
    "utf8"
  )) as unknown, "portable Haxe smoke manifest");
  assert(portableManifest.contract === "genes-official-haxe-smoke",
    "Portable smoke manifest contract changed unexpectedly");
  const activeTests = portableManifest.activeTests;
  assert(Array.isArray(activeTests) && activeTests.length === 5,
    "Portable smoke must retain five reviewed active test identities");
  const portableProfiles = portableManifest.profiles;
  assert(Array.isArray(portableProfiles)
    && portableProfiles.map((entry, index) =>
      text(record(entry, `portable profiles[${index}]`).id, `portable profiles[${index}].id`)
    ).join(",") === "classic-esm,typescript",
  "Portable smoke must retain independent classic and TypeScript reports");
  const adaptation = record(
    portableManifest.runnerAdaptation,
    "portable smoke runnerAdaptation"
  );
  assert(adaptation.disposition === "upstream-harness-adaptation",
    "Portable smoke must expose its local utest runner as a harness adaptation");
  text(adaptation.reason, "portable smoke runnerAdaptation.reason");
  const upstreamAdaptation = adaptation.upstream;
  assert(Array.isArray(upstreamAdaptation)
    && upstreamAdaptation.length === 2,
  "Portable smoke must record the two pinned utest inputs used by its adapter");
  for (const [index, entry] of upstreamAdaptation.entries()) {
    const identity = record(entry, `runnerAdaptation.upstream[${index}]`);
    text(identity.path, `runnerAdaptation.upstream[${index}].path`);
    assert(/^[a-f0-9]{64}$/.test(
      text(identity.sha256, `runnerAdaptation.upstream[${index}].sha256`)
    ), `runnerAdaptation.upstream[${index}] must use SHA-256`);
  }
  const localAdaptation = adaptation.local;
  assert(Array.isArray(localAdaptation)
    && localAdaptation.length === 4,
  "Portable smoke must record every local harness-adaptation input");
  for (const [index, entry] of localAdaptation.entries()) {
    const identity = record(entry, `runnerAdaptation.local[${index}]`);
    const relativePath = text(
      identity.path,
      `runnerAdaptation.local[${index}].path`
    );
    const expectedHash = text(
      identity.sha256,
      `runnerAdaptation.local[${index}].sha256`
    );
    const full = path.join(repoRoot, relativePath);
    assert(existsSync(full),
      `Portable smoke adaptation file is missing: ${relativePath}`);
    assert(sha256(full) === expectedHash,
      `Portable smoke adaptation changed without manifest review: ${relativePath}`);
  }

  const strategy = readFileSync(
    path.join(repoRoot, "docs", "TESTING_STRATEGY.md"),
    "utf8"
  );
  const agentGuide = readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");
  const ci = readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
  const baseline = record(JSON.parse(readFileSync(
    path.join(repoRoot, "tests", "testing-strategy", "ci-baseline.json"),
    "utf8"
  )) as unknown, "CI timing baseline");
  assert(baseline.schemaVersion === 1
    && baseline.contract === "genes-test-loop-baseline",
  "CI timing baseline schema or contract changed unexpectedly");
  assert(Array.isArray(record(baseline.remote, "CI baseline.remote").jobs),
    "CI timing baseline must retain remote job samples");
  assert(Array.isArray(baseline.unknown)
    && baseline.unknown.length > 0,
  "CI timing baseline must state what the initial sample does not establish");
  for (const required of [
    "tests/testing-strategy/agent-test-routing.json",
    "Portable Haxe compatibility",
    "Genes product evidence",
    "official-suite smoke"
  ])
    assert(strategy.includes(required),
      `Testing strategy omits agent-loop contract: ${required}`);
  assert(agentGuide.includes("yarn test:agent-test-routing"),
    "AGENTS.md must name the routing drift check");
  const planSmokeJob = jobBlock(ci, "genes-test-plan-and-smoke", "genes-ts");
  const requiredGenesJob = jobBlock(ci, "genes-ts", "genes-ts-smoke-next-lts");
  const releaseStart = ci.indexOf("\n  release:");
  assert(releaseStart >= 0, "CI workflow is missing the release job");
  const releaseJob = ci.slice(releaseStart);
  assert(!requiredGenesJob.includes("needs: genes-test-plan-and-smoke"),
    "The required genes-ts check must still run when the separate preflight fails");
  assert(planSmokeJob.includes("- run: yarn test:agent-test-routing"),
    "The plan/smoke sentinel must run routing drift validation");
  assert(releaseJob.includes("- genes-test-plan-and-smoke"),
    "Release publication must depend on the claim-bearing plan/smoke job");
  assert(
    String(packageScripts["test:ci"]).includes("yarn test:agent-test-routing"),
    "test:ci must run the routing drift check"
  );
  for (const required of [
    "yarn test:test-tool-preparation",
    "yarn test:ci:explain",
    "yarn test:smoke"
  ])
    assert(String(packageScripts["test:ci"]).includes(required),
      `test:ci must retain ${required}`);
  for (const command of [
    "test:focus",
    "test:smoke",
    "test:pr",
    "test:full",
    "test:ci:explain"
  ])
    assert(typeof packageScripts[command] === "string",
      `package.json is missing required test-loop command: ${command}`);
  assert(planSmokeJob.includes("- run: yarn test:smoke"),
    "The plan/smoke sentinel must run the dual-profile official smoke");
  assert(planSmokeJob.includes("- run: yarn test:ci:explain"),
    "The plan/smoke sentinel must publish observation-mode selection");
  assert(planSmokeJob.includes("- run: yarn test:test-tool-preparation"),
    "The plan/smoke sentinel must prove prepared test-tool invalidation");
  assert(ci.includes("schedule:")
    && ci.includes('cron: "17 7 * * *"'),
  "The observation-mode selector requires a complete scheduled audit backstop");
  assert(
    String(packageScripts["test:ci"]).includes("yarn test:smoke"),
    "test:ci must retain portable smoke and its failure sentinels"
  );

  console.log(
    `agent-test-routing:ok (${gateIds.length} gates, ${routeIds.length} routes, ${impactRuleIds.length} impact rules, portable smoke implemented)`
  );
}

main();
