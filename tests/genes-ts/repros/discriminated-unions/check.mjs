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
run("haxe", ["tests/genes-ts/repros/discriminated-unions/build.hxml"]);
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests/genes-ts/repros/discriminated-unions/tsconfig.json"
]);

const source = readFileSync(path.join(fixtureDir, "out/src-gen/Main.ts"), "utf8");
const declarations = readFileSync(path.join(fixtureDir, "out/dist/Main.d.ts"), "utf8");

assertIncludes(source, "export type TextOnlyRole = \"text\"", "source role singleton");
assertIncludes(source, "export type ToolOnlyRole = \"tool\"", "source role singleton");
assertIncludes(source, "export type Message = TextMessage | ToolMessage", "source union alias");
assertIncludes(source, "role: TextOnlyRole", "source discriminant field");
assertIncludes(source, "role: ToolOnlyRole", "source discriminant field");

assertIncludes(declarations, "export type TextOnlyRole = \"text\";", "declaration role singleton");
assertIncludes(declarations, "export type ToolOnlyRole = \"tool\";", "declaration role singleton");
assertIncludes(declarations, "export type Message = TextMessage | ToolMessage;", "declaration union alias");
assertIncludes(declarations, "role: TextOnlyRole;", "declaration discriminant field");
assertIncludes(declarations, "role: ToolOnlyRole;", "declaration discriminant field");

console.log("discriminated-unions-repro-ok");
