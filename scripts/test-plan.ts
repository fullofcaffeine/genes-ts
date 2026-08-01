import {spawn} from "node:child_process";
import {execFileSync} from "node:child_process";
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

type Ring = "R0" | "R1" | "R2" | "R3" | "R4" | "R5";

interface Gate {
  id: string;
  packageScript: string;
  arguments?: string[];
  owners: string[];
  tier: "focused" | "focused-aggregate" | "acceptance" | "full-release";
  ring: Ring;
  alwaysRun: boolean;
  timeoutSeconds: number;
  historicalDurationMs: number | null;
  remoteJobs: string[];
  artifacts: string[];
}

interface ProductSurface {
  id: string;
  label: string;
  gateIds: string[];
}

function gateCommand(gate: Gate): string {
  return ["yarn", gate.packageScript, ...(gate.arguments ?? [])].join(" ");
}

interface ImpactRule {
  id: string;
  patterns: string[];
  affectedExcludePatterns?: string[];
  selects: string[];
  reason: string;
  affectedSurfaceIds: string[];
  expansion: "affected" | "affected-extended" | "docs-only" | "full";
}

interface TestPlan {
  schemaVersion: number;
  contract: string;
  gates: Gate[];
  productSurfaces: ProductSurface[];
  impactRules: ImpactRule[];
  selectionPolicy: {
    mode: "observation";
    mergeBase: string;
    unknownPath: "full";
    ambiguousOwnership: "full";
    currentRequiredBackstop: string;
  };
}

interface SelectionEntry {
  id: string;
  command: string;
  ring: Ring;
  reasons: string[];
  historicalDurationMs: number | null;
  remoteJobs: string[];
  artifacts: string[];
  coveredSurfaceIds: string[];
}

interface SurfaceSelection {
  id: string;
  label: string;
  reasons: string[];
}

interface AmbiguousOwnership {
  file: string;
  rules: string[];
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const manifestPath = path.join(
  repoRoot,
  "tests",
  "testing-strategy",
  "agent-test-routing.json"
);
const reportRoot = path.join(repoRoot, ".tmp", "test-evidence", "test-plan");
const plan = JSON.parse(readFileSync(manifestPath, "utf8")) as TestPlan;

function coveredSurfaceIds(gateId: string): string[] {
  return plan.productSurfaces
    .filter((surface) => surface.gateIds.includes(gateId))
    .map((surface) => surface.id);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function regexForGlob(glob: string): RegExp {
  let source = "^";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    const next = glob[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index++;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

function matches(glob: string, file: string): boolean {
  const normalized = file.split(path.sep).join("/");
  if (!glob.includes("*")) {
    return normalized === glob
      || normalized.startsWith(`${glob.replace(/\/$/, "")}/`);
  }
  return regexForGlob(glob).test(normalized);
}

function gitLines(args: string[]): string[] {
  return tryGitLines(args).lines;
}

function tryGitLines(args: string[]): {ok: boolean; lines: string[]} {
  try {
    const lines = execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {ok: true, lines};
  } catch {
    return {ok: false, lines: []};
  }
}

function liveChangedFiles(): string[] {
  const mergeBase = process.env.GENES_TEST_PLAN_MERGE_BASE
    ?? plan.selectionPolicy.mergeBase;
  const mergeBaseDiff = tryGitLines([
    "diff",
    "--name-only",
    `${mergeBase}...HEAD`
  ]);
  const candidates = [
    ...(mergeBaseDiff.ok
      ? mergeBaseDiff.lines
      : [`<unreadable-merge-base:${mergeBase}>`]),
    ...gitLines(["diff", "--name-only"]),
    ...gitLines(["diff", "--name-only", "--cached"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"])
  ];
  if (candidates.length === 0 && gitLines(["rev-parse", "--is-inside-work-tree"]).length === 0)
    return ["<unknown-git-state>"];
  return [...new Set(candidates)].sort((left, right) => left.localeCompare(right));
}

function select(changedFiles: string[]): {
  selected: SelectionEntry[];
  omitted: Array<{id: string; reason: string}>;
  matchedRules: Array<{file: string; rules: string[]}>;
  docsOnly: boolean;
  unknownFiles: string[];
  ambiguousFiles: AmbiguousOwnership[];
  affectedSurfaces: SurfaceSelection[];
} {
  const gates = new Map(plan.gates.map((gate) => [gate.id, gate]));
  const reasons = new Map<string, string[]>();
  const matchedRules: Array<{file: string; rules: string[]}> = [];
  const unknownFiles: string[] = [];
  const ambiguousFiles: AmbiguousOwnership[] = [];
  const affectedReasons = new Map<string, string[]>();
  let hasExecutableRule = false;
  let hasExecutableOwner = false;

  function add(id: string, reason: string): void {
    assert(gates.has(id), `Impact selection references unknown gate: ${id}`);
    const current = reasons.get(id) ?? [];
    if (!current.includes(reason)) current.push(reason);
    reasons.set(id, current);
  }

  function affect(id: string, reason: string): void {
    const surface = plan.productSurfaces.find((entry) => entry.id === id);
    assert(surface !== undefined, `Impact selection references unknown surface: ${id}`);
    const current = affectedReasons.get(id) ?? [];
    if (!current.includes(reason)) current.push(reason);
    affectedReasons.set(id, current);
  }

  for (const file of changedFiles) {
    const rules = plan.impactRules.filter((rule) =>
      rule.patterns.some((pattern) => matches(pattern, file)));
    const ownerGates = plan.gates.filter((gate) =>
      gate.owners.some((owner) => matches(owner, file)));
    if (ownerGates.length > 0) hasExecutableOwner = true;
    const executableRules = rules.filter((rule) =>
      rule.expansion !== "docs-only");
    matchedRules.push({
      file,
      rules: [
        ...rules.map((rule) => rule.id),
        ...ownerGates.map((gate) => `owner:${gate.id}`)
      ]
    });
    if (executableRules.length > 1 || ownerGates.length > 1) {
      ambiguousFiles.push({
        file,
        rules: [
          ...executableRules.map((rule) => rule.id),
          ...ownerGates.map((gate) => `owner:${gate.id}`)
        ]
      });
    }
    if (rules.length === 0 && ownerGates.length === 0) {
      unknownFiles.push(file);
      continue;
    }
    for (const rule of rules) {
      if (rule.expansion !== "docs-only") hasExecutableRule = true;
      for (const gate of rule.selects)
        add(gate, `${file} -> rule ${rule.id}: ${rule.reason}`);
      const affectsFile = !(rule.affectedExcludePatterns ?? [])
        .some((pattern) => matches(pattern, file));
      if (affectsFile) {
        for (const surfaceId of rule.affectedSurfaceIds)
          affect(surfaceId, `${file} -> rule ${rule.id}: ${rule.reason}`);
      }
    }
    for (const gate of ownerGates) {
      add(gate.id, `${file} -> declared owner ${gate.owners.find((owner) => matches(owner, file))}`);
      for (const surfaceId of coveredSurfaceIds(gate.id))
        affect(surfaceId,
          `${file} -> direct owner ${gate.id}; selected-gate dependencies do not add affected surfaces`);
    }
  }

  const docsOnly = changedFiles.length > 0
    && !hasExecutableRule
    && !hasExecutableOwner
    && unknownFiles.length === 0;
  if (!docsOnly) {
    for (const gate of plan.gates) {
      if (gate.alwaysRun)
        add(gate.id, "always-run sentinel for every non-docs-only change");
    }
  }
  if (unknownFiles.length > 0) {
    add(plan.selectionPolicy.currentRequiredBackstop,
      `unknown ownership expands safely to full: ${unknownFiles.join(", ")}`);
    for (const surface of plan.productSurfaces)
      affect(surface.id,
        `unknown ownership cannot safely narrow affected surfaces: ${unknownFiles.join(", ")}`);
  }
  if (ambiguousFiles.length > 0) {
    add(
      plan.selectionPolicy.currentRequiredBackstop,
      "ambiguous ownership expands safely to full: "
      + ambiguousFiles
        .map((entry) => `${entry.file} (${entry.rules.join(" + ")})`)
        .join(", ")
    );
  }

  const selected = plan.gates
    .filter((gate) => reasons.has(gate.id))
    .map((gate) => ({
      id: gate.id,
      command: gateCommand(gate),
      ring: gate.ring,
      reasons: reasons.get(gate.id)!,
      historicalDurationMs: gate.historicalDurationMs,
      remoteJobs: gate.remoteJobs,
      artifacts: gate.artifacts,
      coveredSurfaceIds: coveredSurfaceIds(gate.id)
    }));
  const omitted = plan.gates
    .filter((gate) => !reasons.has(gate.id))
    .map((gate) => ({
      id: gate.id,
      reason: docsOnly
        ? "ordinary documentation fast path; no executable or policy owner matched"
        : "no changed owner or declared reverse dependency selected this gate; the current full backstop remains required"
    }));
  return {
    selected,
    omitted,
    matchedRules,
    docsOnly,
    unknownFiles,
    ambiguousFiles,
    affectedSurfaces: plan.productSurfaces
      .filter((surface) => affectedReasons.has(surface.id))
      .map((surface) => ({
        id: surface.id,
        label: surface.label,
        reasons: affectedReasons.get(surface.id)!
      }))
  };
}

function writeSelection(
  mode: string,
  changedFiles: string[],
  selection: ReturnType<typeof select>
): string {
  mkdirSync(reportRoot, {recursive: true});
  const knownDurationMs = selection.selected.reduce(
    (total, entry) => total + (entry.historicalDurationMs ?? 0),
    0
  );
  const unknownDurationCount = selection.selected.filter(
    (entry) => entry.historicalDurationMs === null
  ).length;
  const report = {
    schemaVersion: 1,
    contract: "genes-test-plan-selection",
    mode,
    selectionMode: plan.selectionPolicy.mode,
    authoritativeGate: plan.selectionPolicy.currentRequiredBackstop,
    changedFiles,
    docsOnly: selection.docsOnly,
    unknownFiles: selection.unknownFiles,
    ambiguousFiles: selection.ambiguousFiles,
    matchedRules: selection.matchedRules,
    affectedSurfaces: selection.affectedSurfaces,
    coveredSurfaces: plan.productSurfaces
      .filter((surface) => selection.selected.some((gate) =>
        gate.coveredSurfaceIds.includes(surface.id)))
      .map((surface) => ({
        id: surface.id,
        label: surface.label,
        selectedGateIds: selection.selected
          .filter((gate) => gate.coveredSurfaceIds.includes(surface.id))
          .map((gate) => gate.id)
      })),
    estimatedDuration: {
      knownDurationMs,
      unknownGateCount: unknownDurationCount,
      note: "Historical estimates are planning hints, not blocking time budgets."
    },
    requiredRemoteJobs: [...new Set(
      selection.selected.flatMap((entry) => entry.remoteJobs)
    )].sort(),
    selected: selection.selected,
    omitted: selection.omitted
  };
  const reportPath = path.join(reportRoot, "selection.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

  console.log(`test-plan:${mode} (${plan.selectionPolicy.mode})`);
  console.log(`changed: ${changedFiles.length === 0 ? "<none>" : changedFiles.join(", ")}`);
  for (const surface of selection.affectedSurfaces) {
    console.log(`AFFECT ${surface.id}: ${surface.label}`);
    for (const reason of surface.reasons) console.log(`  because ${reason}`);
  }
  for (const entry of selection.selected) {
    console.log(`SELECT ${entry.id} [${entry.ring}] ${entry.command}`);
    for (const reason of entry.reasons) console.log(`  because ${reason}`);
  }
  for (const entry of selection.omitted)
    console.log(`OMIT   ${entry.id}: ${entry.reason}`);
  console.log(`report: ${path.relative(repoRoot, reportPath)}`);
  return reportPath;
}

async function runGate(entry: SelectionEntry): Promise<void> {
  mkdirSync(reportRoot, {recursive: true});
  const logPath = path.join(reportRoot, `${entry.id}.log`);
  const log = createWriteStream(logPath, {flags: "w"});
  const gate = plan.gates.find((candidate) => candidate.id === entry.id);
  assert(gate !== undefined, `Missing package script for ${entry.id}`);
  const packageScript = gate.packageScript;
  await new Promise<void>((resolve, reject) => {
    const child = spawn("yarn", [packageScript, ...(gate.arguments ?? [])], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${entry.id} exceeded its ${String(
        plan.gates.find((gate) => gate.id === entry.id)?.timeoutSeconds
      )} second plan timeout`));
    }, (plan.gates.find((gate) => gate.id === entry.id)?.timeoutSeconds ?? 600) * 1000);
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk: Buffer) => {
        process.stdout.write(chunk);
        log.write(chunk);
      });
    }
    child.on("error", (error) => {
      clearTimeout(timeout);
      log.end();
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      log.end();
      if (code === 0) resolve();
      else reject(new Error(
        `${entry.id} failed with ${signal === null ? `exit ${String(code)}` : signal}`
      ));
    });
  });
}

async function main(): Promise<void> {
  assert(plan.schemaVersion === 3 && plan.contract === "genes-agent-test-routing",
    "Test plan must be validated schema 3");
  const [mode = "explain", ...rawArguments] = process.argv.slice(2);
  const changedIndex = rawArguments.indexOf("--changed");
  const explicit = changedIndex >= 0
    ? rawArguments.slice(changedIndex + 1)
    : rawArguments;

  if (mode === "focus") {
    assert(explicit.length > 0,
      "Usage: yarn test:focus -- <gate-id-or-changed-path>");
    const exact = plan.gates.find((gate) => gate.id === explicit[0]);
    if (exact !== undefined) {
      assert(exact.tier === "focused" || exact.tier === "focused-aggregate",
        `${exact.id} is not a focused owner; use yarn ${exact.packageScript} directly`);
      const entry: SelectionEntry = {
        id: exact.id,
        command: gateCommand(exact),
        ring: exact.ring,
        reasons: ["explicit focused gate requested"],
        historicalDurationMs: exact.historicalDurationMs,
        remoteJobs: exact.remoteJobs,
        artifacts: exact.artifacts,
        coveredSurfaceIds: coveredSurfaceIds(exact.id)
      };
      writeSelection("focus", explicit, {
        selected: [entry],
        omitted: plan.gates.filter((gate) => gate.id !== exact.id)
          .map((gate) => ({id: gate.id, reason: "not the explicitly requested focused owner"})),
        matchedRules: [],
        docsOnly: false,
        unknownFiles: [],
        ambiguousFiles: [],
        affectedSurfaces: []
      });
      await runGate(entry);
      return;
    }
    const selection = select(explicit);
    const focusedCandidates = selection.selected
      .filter((entry) => {
        const gate = plan.gates.find((candidate) => candidate.id === entry.id);
        return (gate?.tier === "focused" || gate?.tier === "focused-aggregate")
          && entry.reasons.some((reason) =>
            !reason.startsWith("always-run sentinel"));
      })
      .sort((left, right) => {
        const leftOwner = left.reasons.some((reason) =>
          reason.includes(" -> declared owner "));
        const rightOwner = right.reasons.some((reason) =>
          reason.includes(" -> declared owner "));
        if (leftOwner !== rightOwner) return leftOwner ? -1 : 1;
        const ringOrder = ["R0", "R1", "R2", "R3", "R4", "R5"];
        const ring = ringOrder.indexOf(left.ring) - ringOrder.indexOf(right.ring);
        if (ring !== 0) return ring;
        return (left.historicalDurationMs ?? Number.MAX_SAFE_INTEGER)
          - (right.historicalDurationMs ?? Number.MAX_SAFE_INTEGER);
      });
    assert(focusedCandidates.length > 0,
      `No focused owner matched ${explicit.join(", ")}`);
    selection.selected = [focusedCandidates[0]!];
    selection.omitted = plan.gates
      .filter((gate) => gate.id !== focusedCandidates[0]!.id)
      .map((gate) => ({
        id: gate.id,
        reason: "not the smallest matching focused semantic owner"
      }));
    writeSelection("focus", explicit, selection);
    for (const entry of selection.selected) await runGate(entry);
    return;
  }

  const changedFiles = explicit.length > 0 ? explicit : liveChangedFiles();
  const selection = select(changedFiles);
  writeSelection(mode, changedFiles, selection);
  if (mode === "explain") return;
  assert(mode === "pr", `Unknown test-plan mode: ${mode}`);

  const full = selection.selected.find((entry) =>
    entry.id === plan.selectionPolicy.currentRequiredBackstop);
  const execution = full === undefined ? selection.selected : [full];
  for (const entry of execution) await runGate(entry);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
