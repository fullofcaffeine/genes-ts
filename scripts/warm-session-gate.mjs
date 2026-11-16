#!/usr/bin/env node
/**
 * Warm-session gate for a real project copy (G1 of the sub-second plan).
 *
 * Why: `tooling/src/session-warm-server-test.ts` proves on a small fixture
 * that the development session keeps one warm Haxe cache. A large project
 * can still lose the cache in ways the fixture cannot show, for example a
 * macro that sets a changing define. This driver runs the same checks
 * through the real session code path on a COPY of a project.
 *
 * What it does, with this checkout's Genes tooling (`tooling/dist`):
 *
 * 1. Starts a `DevelopmentSession` for the copy. The public output goes to a
 *    new folder (`--output`, default `.warm-gate/out/index.tsx`), so the
 *    copy's committed output is never claimed. The host validator accepts
 *    every candidate: this gate measures the compiler path only.
 * 2. Makes `--edits` edits of one leaf module: each edit replaces the text
 *    of `--marker` (for example a string literal) with a new value.
 * 3. After each build it checks: the server's `server/contexts` list equals
 *    the list after the first build (one signature), the Genes incremental
 *    report keeps records (kept > 0), and records the server size and the
 *    time from save to `build-started` and to acceptance.
 * 4. After the edits named by `--cold-at`, the public tree must equal a cold
 *    build in a new Haxe process, byte for byte.
 * 5. At the end, two saves with the same whole-second file time must both be
 *    built, and the median server size of the last third of the warm builds
 *    must stay within 5% of the median of the first third.
 *
 * It writes one JSON line per build to stdout and a summary at the end, and
 * exits with 1 when a check fails. Timings are evidence only on a quiet host.
 *
 * Never point `--project` at a live checkout or at the owner's running app:
 * the driver edits source files in place.
 *
 * Example (Caffeine copy, one leaf UI module):
 *
 *   node scripts/warm-session-gate.mjs --project /tmp/caffeine-copy \
 *     --hxml development.hxml --haxe ~/haxe/versions/4.3.7/haxe --lix \
 *     --edit src/caffeine/ui/PasswordSettings.hx \
 *     --marker password-settings-title --edits 20 --cold-at 1,10,20
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, loadavg } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tooling = (relative) =>
  import(pathToFileURL(path.join(repositoryRoot, "tooling/dist", relative)).href);
const { createGenesDevelopmentSession } = await tooling("session/index.js");
const { sendHaxeServerRequest } = await tooling("session/haxe-driver.js");
const { resolveLixLibraryGroup } = await tooling("lix/index.js");

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    hxml: { type: "string", default: "build.hxml" },
    haxe: { type: "string", default: path.join(homedir(), "haxe/versions/4.3.7/haxe") },
    output: { type: "string", default: ".warm-gate/out/index.tsx" },
    state: { type: "string", default: ".warm-gate/state" },
    lix: { type: "boolean", default: false },
    allow: { type: "string", multiple: true, default: [] },
    edit: { type: "string" },
    marker: { type: "string" },
    edits: { type: "string", default: "20" },
    "cold-at": { type: "string", default: "1,10,20" },
    timeout: { type: "string", default: "900000" },
  },
});
assert.ok(values.project && values.edit && values.marker,
  "Usage: warm-session-gate.mjs --project COPY --edit FILE.hx --marker TEXT [--hxml F] [--haxe BIN] [--lix] [--edits N] [--cold-at 1,10,20]");
const projectRoot = realpathSync(values.project);
const haxe = realpathSync(values.haxe);
const edits = Number(values.edits);
const coldAt = new Set(values["cold-at"].split(",").map(Number));
const timeoutMs = Number(values.timeout);
const editFile = path.join(projectRoot, values.edit);
assert.ok(readFileSync(editFile, "utf8").includes(values.marker),
  `${values.edit} does not contain the marker ${values.marker}`);
const publicRoot = path.join(projectRoot, path.dirname(values.output));
const entry = path.basename(values.output);
const failures = [];
const check = (condition, message) => {
  if (!condition) {
    failures.push(message);
    console.log(JSON.stringify({ failed: message }));
  }
};

/** Returns the sorted relative paths and SHA-256 digests of a tree. */
function treeDigest(root) {
  const entries = [];
  const walk = (relative) => {
    for (const name of readdirSync(path.join(root, relative)).sort()) {
      const child = relative.length === 0 ? name : `${relative}/${name}`;
      const absolute = path.join(root, child);
      if (statSync(absolute).isDirectory()) walk(child);
      else entries.push(`${child} ${createHash("sha256").update(readFileSync(absolute)).digest("hex")}`);
    }
  };
  walk("");
  return entries;
}

/**
 * Builds the current sources in a new Haxe process. The cold tree is at the
 * depth of the session's candidate folder (`<state>/candidates/<rev>/output`),
 * because source maps hold paths relative to the folder Genes wrote.
 */
function coldTree() {
  const depth = values.state.split("/").filter(Boolean).length + 3;
  const coldParent = path.join(projectRoot, ".warm-gate-cold");
  const coldRoot = path.join(coldParent, ...Array.from({ length: depth - 1 }, (_, i) => `d${i}`));
  rmSync(coldParent, { recursive: true, force: true });
  const executable = values.lix ? path.join(projectRoot, "node_modules/.bin/haxe") : haxe;
  const result = spawnSync(executable, [
    values.hxml,
    "--js", path.join(coldParent, "haxe-target", "compiler.js"),
    "-D", `genes.output=${path.join(coldRoot, entry)}`,
  ], { cwd: projectRoot, encoding: "utf8", timeout: timeoutMs });
  assert.equal(result.status, 0, `cold build failed\n${result.stdout}${result.stderr}`);
  return treeDigest(coldRoot);
}

const lease = () => JSON.parse(readFileSync(path.join(projectRoot, values.state, "haxe-server.json"), "utf8"));
const serverCaches = async () => {
  const { port } = lease();
  const answer = await sendHaxeServerRequest(
    { host: "127.0.0.1", port, argument: `127.0.0.1:${port}` },
    projectRoot, "server/contexts", {}, 60_000);
  return JSON.parse(answer.slice(answer.indexOf("{"))).result.result
    .map((context) => `${context.platform} ${context.desc} ${context.signature}`).sort();
};
const keptRecords = () => {
  const report = JSON.parse(readFileSync(
    path.join(projectRoot, values.state, "haxe-request/incremental.json.after-typing.json"), "utf8"));
  return { mode: report.mode, reason: report.reason, typedAgain: report.typedAgain,
    kept: report.passes.reduce((total, pass) => total + pass.kept, 0) };
};
const residentKilobytes = (pid) =>
  Number.parseInt(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim(), 10);
const publishedContains = (text) => {
  const search = (directory) => readdirSync(directory).some((name) => {
    const absolute = path.join(directory, name);
    return statSync(absolute).isDirectory() ? search(absolute) : readFileSync(absolute, "utf8").includes(text);
  });
  return search(publicRoot);
};

const lixEntry = path.join(projectRoot, "node_modules/lix/bin/haxelibshim.js");
const events = [];
const session = createGenesDevelopmentSession({
  projectRoot,
  projectIdentity: "warm-session-gate",
  hxml: {
    allowedRoots: [projectRoot, path.dirname(haxe), path.join(repositoryRoot, "src"), ...values.allow.map((dir) => realpathSync(dir))],
    ...(values.lix ? {
      resolveLibraries: (requests, { signal }) => resolveLixLibraryGroup({
        projectRoot, requests, signal,
        command: { executable: process.execPath, argsPrefix: [lixEntry] },
        timeoutMs: 60_000,
      }),
    } : {}),
  },
  publicOutputFile: values.output,
  stateDirectory: values.state,
  resolveInvocation: () => ({
    executable: haxe, cwd: projectRoot, args: [values.hxml],
    ioPolicy: "haxe-4.3.7-development-js-v1",
    env: { NODE_ENV: "development" },
    compatibilityFacts: { gate: "warm-session" },
  }),
  validate: async () => ({ ok: true }),
  validatorPolicyFacts: { gate: "accept-every-candidate" },
  debounceMs: 0,
});
session.subscribe((event) => events.push({ at: Date.now(), event: event.event }));

const waitForGeneration = async (generation) => {
  const started = Date.now();
  while ((session.inspect().accepted?.generation ?? 0) < generation) {
    assert.ok(!["degraded", "blocked"].includes(session.state.kind),
      `session failed: ${JSON.stringify(session.inspect())}`);
    assert.ok(Date.now() - started < timeoutMs, `no generation ${generation}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await session.waitForIdle();
  }
};

let firstCaches = null;
const memory = [];
const record = async (label, generation, savedAt) => {
  const caches = await serverCaches();
  firstCaches ??= caches;
  check(JSON.stringify(caches) === JSON.stringify(firstCaches), `${label}: Haxe cache signatures changed: ${caches.length} caches`);
  const kept = keptRecords();
  check(kept.mode === "measure", `${label}: incremental mode ${kept.mode} (${kept.reason})`);
  if (generation > 1) check(kept.kept > 0, `${label}: Genes kept no record`);
  memory.push(residentKilobytes(lease().serverPid));
  const started = events.find((item) => item.event.kind === "build-started" && item.at >= savedAt);
  console.log(JSON.stringify({
    label, generation, caches: caches.length, kept: kept.kept, typedAgain: kept.typedAgain,
    serverRssKiB: memory.at(-1), load: loadavg()[0],
    saveToRequestMs: savedAt === null || started === undefined ? null : started.at - savedAt,
    saveToAcceptedMs: savedAt === null ? null : Date.now() - savedAt,
  }));
};

try {
  await session.start();
  await waitForGeneration(1);
  await record("first build", 1, null);
  let current = values.marker;
  let generation = 1;
  const save = (next, seconds) => {
    writeFileSync(editFile, readFileSync(editFile, "utf8").replace(current, next));
    current = next;
    if (seconds !== undefined) utimesSync(editFile, seconds, seconds);
    return Date.now();
  };
  for (let index = 1; index <= edits; index += 1) {
    const savedAt = save(`${values.marker}-w${index}`);
    generation += 1;
    await waitForGeneration(generation);
    await record(`edit ${index}`, generation, savedAt);
    check(publishedContains(current), `edit ${index}: the published tree lacks ${current}`);
    if (coldAt.has(index)) {
      check(JSON.stringify(treeDigest(publicRoot)) === JSON.stringify(coldTree()), `edit ${index}: tree differs from cold`);
    }
  }
  const second = Math.floor(statSync(editFile).mtimeMs / 1000) + 2;
  let savedAt = save(`${values.marker}-same-second-a`, second);
  generation += 1;
  await waitForGeneration(generation);
  await record("first save in one second", generation, savedAt);
  savedAt = save(`${values.marker}-same-second-b`, second);
  generation += 1;
  await waitForGeneration(generation);
  await record("second save in the same second", generation, savedAt);
  check(publishedContains(current), "the second save within one second was not built");
  // The process size moves with garbage collection (the minor heap alone is
  // 32 MB), so compare medians: the last third of the warm builds against
  // the first third. A new cache per build grows the process each build.
  const warm = memory.slice(1);
  const third = Math.max(1, Math.floor(warm.length / 3));
  const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const early = median(warm.slice(0, third));
  const late = median(warm.slice(-third));
  check(late <= early * 1.05, `server memory grew from a median ${early} KiB to ${late} KiB (limit 5%)`);
  check(events.filter((item) => item.event.kind === "compiler-lifecycle" && item.event.event.kind === "started").length === 1,
    "the session started more than one Haxe server");
} finally {
  await session.close();
}
console.log(JSON.stringify({ summary: failures.length === 0 ? "passed" : "failed", failures }));
process.exitCode = failures.length === 0 ? 0 : 1;
