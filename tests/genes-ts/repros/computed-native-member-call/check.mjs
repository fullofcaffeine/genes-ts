#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const fixtureDir = path.dirname(__filename);
const repoRoot = path.resolve(fixtureDir, "../../../..");

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: repoRoot, stdio: "inherit" });
}

function assertIncludes(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} missing expected output:\n${expected}\n\nActual output:\n${source}`);
  }
}

rmSync(path.join(fixtureDir, "out"), { recursive: true, force: true });
run("haxe", ["tests/genes-ts/repros/computed-native-member-call/build.hxml"]);
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests/genes-ts/repros/computed-native-member-call/tsconfig.json"
]);

const source = readFileSync(path.join(fixtureDir, "out/src-gen/Main.ts"), "utf8");
const declarations = readFileSync(path.join(fixtureDir, "out/dist/Main.d.ts"), "utf8");

assertIncludes(source, "[Symbol.asyncIterator](): AsyncIterator<number>", "computed method definition");
assertIncludes(source, "stream[Symbol.asyncIterator]().next()", "computed method call");
assertIncludes(declarations, "[Symbol.asyncIterator](): AsyncIterator<number>;", "computed declaration method");

console.log("computed-native-member-call-repro-ok");

