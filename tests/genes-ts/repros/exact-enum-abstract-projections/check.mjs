#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTypeScriptMatrix } from "../toolchains.mjs";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(fixtureDir, "../../../..");

function run(command, args) {
  execFileSync(command, args, { cwd: repoRoot, stdio: "inherit" });
}

function requireFragment(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error(`${label} missing expected output:\n${fragment}\n\nActual output:\n${source}`);
  }
}

rmSync(path.join(fixtureDir, "out"), { recursive: true, force: true });
run("haxe", ["tests/genes-ts/repros/exact-enum-abstract-projections/build-ts.hxml"]);
runTypeScriptMatrix(["-p", "tests/genes-ts/repros/exact-enum-abstract-projections/tsconfig.json"]);

const source = readFileSync(
  path.join(fixtureDir, "out/typescript/src-gen/Main.ts"),
  "utf8",
);
requireFragment(
  source,
  "let state: ['draft' | 'published', (value: 'draft' | 'published') => void] = DomainHost.make",
  "closed generic tuple",
);
requireFragment(source, "state[1](next);", "exact method argument");
requireFragment(source, "Main.replaceFromMethod(state, next);", "exact nested callback argument");
requireFragment(source, 'return {"phase": state[0], "select": select};', "exact tuple projection");
requireFragment(
  source,
  "static replaceFromBroadParameter(state: ['draft' | 'published', (value: 'draft' | 'published') => void], next: string)",
  "deliberately broad parameter control",
);
requireFragment(
  source,
  "state[1]((next as 'draft' | 'published'));",
  "required broad-to-closed assertion",
);
requireFragment(
  source,
  "state[1]((broadBox.value as 'draft' | 'published'));",
  "required broad generic-field assertion",
);
const assertions = source.match(/\sas\s/g) ?? [];
if (assertions.length !== 2) {
  throw new Error(`only the two deliberately broad controls should need TypeScript assertions:\n${source}`);
}

run("haxe", ["tests/genes-ts/repros/exact-enum-abstract-projections/build-classic.hxml"]);
run("node", ["tests/genes-ts/repros/exact-enum-abstract-projections/runtime.mjs"]);

console.log("exact-enum-abstract-projections-repro-ok");
