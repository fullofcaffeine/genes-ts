#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const distRoot = path.join(scriptDir, "dist");
const stampPath = path.join(distRoot, ".prepared-test-tools.json");
const staticInputs = [
  "package.json",
  "yarn.lock",
  "config/toolchains.json",
  "scripts/tsconfig.json",
  "scripts/run-typescript.mjs",
  "scripts/prepare-test-tools.mjs"
];

function listFiles(root, predicate) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full, predicate));
    else if (entry.isFile() && predicate(full)) files.push(full);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

function hashEntries(entries) {
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(entry.path);
    hash.update("\0");
    hash.update(entry.bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function sourceIdentity() {
  const sourceFiles = listFiles(scriptDir, (file) =>
    file.endsWith(".ts") && !file.startsWith(`${distRoot}${path.sep}`));
  const inputs = [
    ...sourceFiles.map((file) => relative(file)),
    ...staticInputs
  ];
  const uniqueInputs = [...new Set(inputs)].sort((left, right) =>
    left.localeCompare(right));
  return {
    hash: hashEntries(uniqueInputs.map((input) => ({
      path: input,
      bytes: readFileSync(path.join(repoRoot, input))
    }))),
    inputs: uniqueInputs
  };
}

function outputIdentity() {
  const outputs = listFiles(distRoot, (file) =>
    file.endsWith(".js") && file !== stampPath);
  return {
    hash: hashEntries(outputs.map((file) => ({
      path: relative(file),
      bytes: readFileSync(file)
    }))),
    outputs: outputs.map(relative)
  };
}

function readStamp() {
  if (!existsSync(stampPath)) return null;
  try {
    return JSON.parse(readFileSync(stampPath, "utf8"));
  } catch {
    return null;
  }
}

function prepared(source) {
  const stamp = readStamp();
  if (
    stamp?.schemaVersion !== 1
    || stamp.sourceHash !== source.hash
    || !Array.isArray(stamp.outputs)
    || typeof stamp.outputHash !== "string"
  ) {
    return false;
  }
  for (const output of stamp.outputs) {
    if (typeof output !== "string" || !existsSync(path.join(repoRoot, output)))
      return false;
  }
  const current = outputIdentity();
  return current.hash === stamp.outputHash
    && JSON.stringify(current.outputs) === JSON.stringify(stamp.outputs);
}

function compile(source) {
  rmSync(distRoot, {recursive: true, force: true});
  mkdirSync(distRoot, {recursive: true});
  const startedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    ["scripts/run-typescript.mjs", "apiBridge", "-p", "scripts/tsconfig.json"],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
      timeout: 120_000
    }
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0)
    throw new Error(`test-tool TypeScript build failed with exit ${String(result.status)}`);

  const output = outputIdentity();
  writeFileSync(stampPath, JSON.stringify({
    schemaVersion: 1,
    sourceHash: source.hash,
    outputHash: output.hash,
    inputs: source.inputs,
    outputs: output.outputs,
    preparedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt
  }, null, 2) + "\n");
  console.log(
    `[test-tools] rebuilt ${output.outputs.length} scripts for source ${source.hash.slice(0, 12)}`
  );
}

const source = sourceIdentity();
if (prepared(source)) {
  const ageMs = Date.now() - statSync(stampPath).mtimeMs;
  console.log(
    `[test-tools] prepared cache hit ${source.hash.slice(0, 12)} (${Math.round(ageMs)}ms old)`
  );
} else {
  compile(source);
}
