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
  "dependency-review",
  "codeql",
  "beads-worktree-safety",
  "beads-pinned-client",
  "secrets",
  "vulns",
  "classic",
  "genes-test-plan-and-smoke",
  "genes-ts",
  "genes-ts-smoke-next-lts",
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
  assert(manifest.schemaVersion === 3, "Unsupported agent test-routing schema");
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

  const compatibilityEvidence = record(JSON.parse(readFileSync(
    path.join(repoRoot, "tests", "compatibility", "evidence.json"),
    "utf8"
  )) as unknown, "compatibility evidence");
  const compatibilityBucketIds = new Set(
    (compatibilityEvidence.buckets as unknown[]).map((entry, index) =>
      text(record(entry, `compatibility buckets[${index}]`).id,
        `compatibility buckets[${index}].id`)
    )
  );
  const exampleManifest = record(JSON.parse(readFileSync(
    path.join(repoRoot, "examples", "profiles.json"),
    "utf8"
  )) as unknown, "example profiles");
  const exampleIds = new Set(Object.keys(record(exampleManifest.examples,
    "example profiles.examples")));
  const surfaceEntries = manifest.productSurfaces;
  assert(Array.isArray(surfaceEntries) && surfaceEntries.length > 0,
    "Manifest must define independent product-surface scorecards");
  const surfaceIds: string[] = [];
  const surfacesById = new Map<string, Record<string, unknown>>();
  for (const [index, entry] of surfaceEntries.entries()) {
    const surface = record(entry, `productSurfaces[${index}]`);
    const id = text(surface.id, `productSurfaces[${index}].id`);
    const kind = text(surface.kind, `${id}.kind`);
    assert(kind === "product" || kind === "evidence-portfolio",
      `${id}.kind must be product or evidence-portfolio`);
    for (const field of [
      "label", "owner", "claim", "claimCeiling", "lastCleanProof"
    ]) text(surface[field], `${id}.${field}`);
    const evidenceBucketIds = stringArray(surface.evidenceBucketIds,
      `${id}.evidenceBucketIds`, true);
    for (const bucketId of evidenceBucketIds)
      assert(compatibilityBucketIds.has(bucketId),
        `${id} references unknown compatibility bucket: ${bucketId}`);
    const claimedExamples = stringArray(surface.exampleIds,
      `${id}.exampleIds`, true);
    for (const exampleId of claimedExamples)
      assert(exampleIds.has(exampleId),
        `${id} references unknown maintained example: ${exampleId}`);
    stringArray(surface.gateIds, `${id}.gateIds`);
    stringArray(surface.residualRisks, `${id}.residualRisks`, true);
    surfaceIds.push(id);
    surfacesById.set(id, surface);
  }
  unique(surfaceIds, "product surface IDs");
  const portfolio = surfacesById.get("example-portfolio");
  assert(portfolio?.kind === "evidence-portfolio",
    "example-portfolio must remain the maintained-example evidence portfolio");
  const portfolioExamples = stringArray(portfolio.exampleIds,
    "example-portfolio.exampleIds", true).slice().sort();
  const maintainedExamples = [...exampleIds].sort();
  assert(JSON.stringify(portfolioExamples) === JSON.stringify(maintainedExamples),
    "example-portfolio.exampleIds must exactly match the maintained example inventory");
  const productSurfaceIds = new Set(surfaceIds.filter((id) =>
    surfacesById.get(id)?.kind === "product"));
  const declaredExamples = record(exampleManifest.examples,
    "example profiles.examples");
  for (const [exampleId, rawExample] of Object.entries(declaredExamples)) {
    const example = record(rawExample, `example ${exampleId}`);
    const tier = text(example.tier, `${exampleId}.tier`);
    assert([
      "flagship-application", "capability-showcase", "compile-only-snippet"
    ].includes(tier), `${exampleId}.tier is unsupported`);
    if (exampleId === "todoapp")
      assert(tier === "flagship-application", "todoapp must remain the flagship application");
    if (exampleId === "typescript-target")
      assert(tier === "capability-showcase", "typescript-target must remain the capability showcase");
    const claims = stringArray(example.claimSurfaceIds,
      `${exampleId}.claimSurfaceIds`, tier === "compile-only-snippet");
    assert(tier !== "compile-only-snippet" || claims.length === 0,
      `${exampleId} compile-only snippets cannot claim product surfaces`);
    unique(claims, `${exampleId}.claimSurfaceIds`);
    for (const surfaceId of claims) {
      assert(productSurfaceIds.has(surfaceId),
        `${exampleId} may claim only product surfaces, not ${surfaceId}`);
      assert(stringArray(surfacesById.get(surfaceId)?.exampleIds,
        `${surfaceId}.exampleIds`, true).includes(exampleId),
      `${exampleId} claims ${surfaceId}, but its scorecard does not name the example`);
    }
  }
  for (const [surfaceId, surface] of surfacesById) {
    if (surface.kind !== "product") continue;
    for (const exampleId of stringArray(surface.exampleIds,
      `${surfaceId}.exampleIds`, true)) {
      const example = record(declaredExamples[exampleId], `example ${exampleId}`);
      assert(stringArray(example.claimSurfaceIds,
        `${exampleId}.claimSurfaceIds`).includes(surfaceId),
      `${surfaceId} names ${exampleId}, but the example does not claim that surface`);
    }
  }

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
        "official-haxe-inventory",
        "official-haxe-inventory-drift",
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
  for (const [surfaceId, surface] of surfacesById) {
    const surfaceGateIds = stringArray(surface.gateIds, `${surfaceId}.gateIds`);
    unique(surfaceGateIds, `${surfaceId}.gateIds`);
    for (const gateId of surfaceGateIds)
      assert(gatesById.has(gateId),
        `${surfaceId} references unknown gate: ${gateId}`);
  }
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
  const routedExampleIds = new Set<string>();
  for (const [index, entry] of impactRules.entries()) {
    const rule = record(entry, `impactRules[${index}]`);
    const id = text(rule.id, `impactRules[${index}].id`);
    stringArray(rule.patterns, `${id}.patterns`);
    if (rule.affectedExcludePatterns !== undefined)
      stringArray(rule.affectedExcludePatterns, `${id}.affectedExcludePatterns`);
    const selected = stringArray(rule.selects, `${id}.selects`);
    for (const gateId of selected)
      assert(gatesById.has(gateId), `${id} selects unknown gate: ${gateId}`);
    text(rule.reason, `${id}.reason`);
    const affectedSurfaceIds = stringArray(rule.affectedSurfaceIds,
      `${id}.affectedSurfaceIds`, true);
    unique(affectedSurfaceIds, `${id}.affectedSurfaceIds`);
    for (const surfaceId of affectedSurfaceIds)
      assert(surfacesById.has(surfaceId),
        `${id} references unknown affected surface: ${surfaceId}`);
    const coveredBySelected = new Set(selected.flatMap((gateId) =>
      surfaceIds.filter((surfaceId) => stringArray(
        surfacesById.get(surfaceId)?.gateIds,
        `${surfaceId}.gateIds`
      ).includes(gateId))
    ));
    for (const surfaceId of affectedSurfaceIds)
      assert(coveredBySelected.has(surfaceId),
        `${id} affects ${surfaceId} but selects no gate that covers it`);
    if (rule.exampleId !== undefined) {
      const exampleId = text(rule.exampleId, `${id}.exampleId`);
      assert(!routedExampleIds.has(exampleId),
        `Maintained example has more than one product-claim route: ${exampleId}`);
      const example = record(declaredExamples[exampleId], `example ${exampleId}`);
      const owner = text(example.owner, `${exampleId}.owner`);
      assert(stringArray(rule.patterns, `${id}.patterns`).includes(`${owner}/**`),
        `${id} must route its example owner: ${owner}/**`);
      const claims = stringArray(example.claimSurfaceIds,
        `${exampleId}.claimSurfaceIds`, true).slice().sort();
      const affected = affectedSurfaceIds.slice().sort();
      assert(JSON.stringify(affected) === JSON.stringify(claims),
        `${id}.affectedSurfaceIds must exactly match ${exampleId}.claimSurfaceIds`);
      routedExampleIds.add(exampleId);
    }
    assert(validExpansions.has(text(rule.expansion, `${id}.expansion`)),
      `${id} has unsupported expansion`);
    impactRuleIds.push(id);
  }
  unique(impactRuleIds, "impact rule IDs");
  for (const [exampleId, rawExample] of Object.entries(declaredExamples)) {
    const example = record(rawExample, `example ${exampleId}`);
    const claims = stringArray(example.claimSurfaceIds,
      `${exampleId}.claimSurfaceIds`, true);
    if (claims.length > 0)
      assert(routedExampleIds.has(exampleId),
        `Claim-bearing example has no product-claim impact rule: ${exampleId}`);
  }

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
  assert(gatesById.get("official-haxe-inventory")?.alwaysRun === true,
    "Official Haxe inventory must remain an always-run non-docs sentinel");
  assert(gatesById.get("official-haxe-inventory-drift")?.alwaysRun === true,
    "Official Haxe inventory drift must remain an always-run non-docs sentinel");
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
  assert(planned.status === "inventory-and-smoke-implemented",
    "Portable Haxe evidence status must match the implemented inventory and smoke boundaries");
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
  const officialInventoryManifest = record(JSON.parse(readFileSync(
    path.join(repoRoot, "tests", "official-haxe-inventory", "manifest.json"),
    "utf8"
  )) as unknown, "official Haxe inventory manifest");
  assert(officialInventoryManifest.contract === "genes-official-haxe-active-inventory",
    "Official Haxe inventory manifest contract changed unexpectedly");
  assert(officialInventoryManifest.disposition === "inventory-only",
    "Official Haxe inventory must state its no-runtime-claim boundary");
  const officialExpected = record(
    officialInventoryManifest.expected,
    "official Haxe inventory expected"
  );
  assert(officialExpected.testsPerProfile === 1373,
    "Official Haxe inventory reviewed count drifted");
  const portableManifest = record(JSON.parse(readFileSync(
    path.join(repoRoot, "tests", "portable-haxe-smoke", "manifest.json"),
    "utf8"
  )) as unknown, "portable Haxe smoke manifest");
  assert(portableManifest.contract === "genes-official-haxe-smoke",
    "Portable smoke manifest contract changed unexpectedly");
  const activeTests = portableManifest.activeTests;
  assert(Array.isArray(activeTests) && activeTests.length === 6,
    "Portable smoke must retain six reviewed active test identities");
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
  const planSmokeJob = jobBlock(
    ci,
    "genes-test-plan-and-smoke",
    "official-haxe-representative"
  );
  const representativeJob = jobBlock(
    ci,
    "official-haxe-representative",
    "genes-ts"
  );
  const requiredGenesJob = jobBlock(ci, "genes-ts", "genes-ts-smoke-next-lts");
  const releaseStart = ci.indexOf("\n  release:");
  assert(releaseStart >= 0, "CI workflow is missing the release job");
  const releaseJob = ci.slice(releaseStart);
  assert(/^    needs: genes-test-plan-and-smoke$/m.test(requiredGenesJob),
    "The required genes-ts check must depend on the claim-bearing preflight");
  assert(/^    if: \$\{\{ !cancelled\(\) \}\}$/m.test(requiredGenesJob),
    "The required genes-ts check must report when its preflight fails");
  assert(!/^    continue-on-error:/m.test(requiredGenesJob),
    "The protected genes-ts job must not tolerate a job-level failure");
  const guardStart = requiredGenesJob.indexOf(
    "- name: Require the test plan and official Haxe smoke"
  );
  const checkoutStart = requiredGenesJob.indexOf(
    "- uses: actions/checkout@v4"
  );
  assert(guardStart >= 0 && checkoutStart > guardStart,
    "The required genes-ts check is missing its pre-checkout smoke guard");
  const guardStep = requiredGenesJob.slice(guardStart, checkoutStart);
  assert(/^        if: \$\{\{ needs\.genes-test-plan-and-smoke\.result != 'success' \}\}$/m
    .test(guardStep),
  "The smoke result condition must guard the failing pre-checkout step");
  assert(/^          exit 1$/m.test(guardStep),
    "The protected smoke guard must terminate with a nonzero status");
  assert(!guardStep.includes("continue-on-error"),
    "The protected smoke guard must not allow its failure to continue");
  assert(planSmokeJob.includes("- run: yarn test:agent-test-routing"),
    "The plan/smoke sentinel must run routing drift validation");
  assert(planSmokeJob.includes("- run: yarn test:compatibility-report"),
    "The plan/smoke sentinel must own generated compatibility claims");
  for (const command of [
    "test:official-haxe-inventory",
    "test:official-haxe-inventory:failures"
  ]) {
    assert(planSmokeJob.includes(`- run: yarn ${command}`),
      `The plan/smoke sentinel must run ${command}`);
    assert(String(packageScripts["test:ci"]).includes(`yarn ${command}`),
      `test:ci must retain ${command}`);
  }
  assert(releaseJob.includes("- genes-test-plan-and-smoke"),
    "Release publication must depend on the claim-bearing plan/smoke job");
  assert(releaseJob.includes("- official-haxe-representative"),
    "Release publication must depend on exact representative evidence");
  assert(representativeJob.includes(
    "if: github.event_name == 'schedule' || (github.event_name == 'push' && github.ref == 'refs/heads/main')"
  ), "Representative evidence must run only for scheduled and release scopes");
  assert(representativeJob.includes(
    "- run: yarn test:official-haxe-representative"
  ), "Representative evidence job must run the stable public command");
  assert(representativeJob.includes(
    "name: Official Haxe representative evidence"
  ), "Representative evidence must keep a stable hosted check name");
  assert(representativeJob.includes("timeout-minutes: 30"),
    "Representative evidence job must have a reviewed runtime bound");
  assert(representativeJob.includes(
    "name: ${{ env.GENES_OFFICIAL_HAXE_EVIDENCE_ARTIFACT }}"
  ), "Representative evidence artifact must carry its scope and exact SHA");
  for (const identity of ["github.run_id", "github.run_attempt"]) {
    assert(representativeJob.includes(identity),
      `Representative artifact identity must include ${identity}`);
  }
  assert(!planSmokeJob.includes("test:official-haxe-representative"),
    "Normal pull-request smoke must not run the representative lane");
  assert(stringArray(
    gatesById.get("classic-core")?.remoteJobs,
    "classic-core.remoteJobs"
  ).includes("classic"),
    "Classic core must point at the hosted classic job that executes yarn test"
  );
  assert(stringArray(
    gatesById.get("compatibility-inventory")?.remoteJobs,
    "compatibility-inventory.remoteJobs"
  ).includes("genes-test-plan-and-smoke"),
    "Compatibility inventory must point at its hosted smoke/plan owner"
  );
  const fullRemoteJobs = new Set(stringArray(
    gatesById.get("full-ci")?.remoteJobs,
    "full-ci.remoteJobs"
  ));
  for (const requiredRemote of [
    "dependency-review",
    "codeql",
    "beads-worktree-safety",
    "beads-pinned-client",
    "secrets",
    "vulns",
    "classic",
    "genes-test-plan-and-smoke",
    "genes-ts",
    "genes-ts-smoke-next-lts"
  ])
    assert(fullRemoteJobs.has(requiredRemote),
      `Full CI remote hints omit hosted job: ${requiredRemote}`);
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
    `agent-test-routing:ok (${gateIds.length} gates, ${surfaceIds.length} product surfaces, ${routeIds.length} routes, ${impactRuleIds.length} impact rules, portable inventory and smoke implemented)`
  );
}

main();
