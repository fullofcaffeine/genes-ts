#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
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

function runFailure(command, args, expected, label) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) {
    throw new Error(`${label} unexpectedly succeeded`);
  }
  if (!output.includes(expected)) {
    throw new Error(`${label} missing exact diagnostic ${JSON.stringify(expected)}:\n${output}`);
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
requireFragment(
  source,
  "Main.consumePhase((source.value as 'draft' | 'published'));",
  "required broad receiver assertion",
);
requireFragment(source, "value: Value", "generic declaration remains generic");
requireFragment(
  source,
  'export type ReviewEnvelope = Envelope<"approved" | "pending">',
  "concrete alias keeps its exact argument",
);
requireFragment(
  source,
  'envelope: Envelope<"approved" | "pending">',
  "closed generic argument",
);
requireFragment(
  source,
  'export type ReviewStateAlias = "approved" | "pending"',
  "closed typedef alias",
);
requireFragment(
  source,
  "aliased: ReviewStateAlias",
  "closed aliased field",
);
requireFragment(
  source,
  'select: (arg0: "approved" | "pending") => void',
  "closed structural callback",
);
requireFragment(
  source,
  'selectMany: (arg0: ("approved" | "pending")[]) => ("approved" | "pending")[]',
  "closed callback arrays",
);
requireFragment(
  source,
  'optionalSelect: (((arg0: "approved" | "pending") => void)) | null',
  "closed nullable callback",
);
requireFragment(
  source,
  'let select: ((next: "approved" | "pending") => void) = function (next: "approved" | "pending")',
  "closed local callback",
);
requireFragment(
  source,
  'preserveReviews(values: ("approved" | "pending")[], transform: ((arg0: "approved" | "pending") => "approved" | "pending")): ("approved" | "pending")[]',
  "closed method parameters and result",
);
if (/Envelope<string>|\(arg0: string\)|\(next: string\)/.test(source)) {
  throw new Error(`closed structural domains widened to string:\n${source}`);
}
const assertions = source.match(/\sas\s/g) ?? [];
if (assertions.length !== 3) {
  throw new Error(`only the three deliberately broad controls should need TypeScript assertions:\n${source}`);
}
runFailure(
  "haxe",
  ["tests/genes-ts/repros/exact-enum-abstract-projections/build-negative.hxml"],
  "OtherReviewState should be ReviewState",
  "wrong-domain Haxe control",
);

run("haxe", ["tests/genes-ts/repros/exact-enum-abstract-projections/build-classic.hxml"]);
const classicDeclaration = readFileSync(
  path.join(fixtureDir, "out/classic/Main.d.ts"),
  "utf8",
);
requireFragment(
  classicDeclaration,
  "export type Envelope<Value> = {\n\tvalue: Value",
  "classic declaration keeps the generic definition",
);
requireFragment(
  classicDeclaration,
  "select: (arg0: 'draft' | 'published') => void",
  "classic declaration preserves an explicit enum projection",
);
run("node", ["tests/genes-ts/repros/exact-enum-abstract-projections/runtime.mjs"]);

console.log("exact-enum-abstract-projections-repro-ok");
