import { ok } from "node:assert";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import {
  cpSync,
  existsSync,
  readFileSync,
  rmSync
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function run(
  command: string,
  args: ReadonlyArray<string>,
  options: ExecFileSyncOptions = {}
): void {
  execFileSync(command, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...options
  });
}

const outputRoot = path.join(repoRoot, "tests/type-roots/out");
const generatedRoot = path.join(outputRoot, "src-gen");
const classicOutputRoot = path.join(repoRoot, "tests/type-roots/out-classic");
rmSync(outputRoot, { recursive: true, force: true });
rmSync(classicOutputRoot, { recursive: true, force: true });

run("haxe", ["tests/type-roots/build.hxml"]);

const namedContract = path.join(
  generatedRoot,
  "type_roots/NamedContract.ts"
);
const incidentalContract = path.join(
  generatedRoot,
  "type_roots/AmbientHost.ts"
);
const exportedContract = path.join(
  generatedRoot,
  "type_roots/ExportedContract.ts"
);
ok(existsSync(namedContract),
  "a user typedef named by generated TypeScript must remain reachable");
ok(existsSync(exportedContract),
  "an explicitly exposed standalone typedef must remain a root");
ok(!existsSync(incidentalContract),
  "a typedef loaded only through an unused ambient-extern member is not a root");

const mainSource = readFileSync(
  path.join(generatedRoot, "type_roots/Main.ts"),
  "utf8"
);
ok(mainSource.includes(
  'import type {NamedContract} from "./NamedContract.js"'
));
ok(mainSource.includes("static render(named: NamedContract): string"));
ok(mainSource.includes("ambientHost.ready"));
ok(!mainSource.includes("AmbientHost.js"));

const entrySource = readFileSync(path.join(generatedRoot, "index.ts"), "utf8");
ok(entrySource.includes(
  'export type {ExportedContract} from "./type_roots/ExportedContract.js"'
));

run("haxe", ["tests/type-roots/build-classic.hxml"]);
ok(existsSync(path.join(
  classicOutputRoot,
  "type_roots/ExportedContract.d.ts"
)), "classic declarations retain an explicitly exposed standalone typedef");
ok(!existsSync(path.join(
  classicOutputRoot,
  "type_roots/ExportedContract.js"
)), "a type-only classic declaration must not create a JavaScript module");
const classicEntryDeclaration = readFileSync(
  path.join(classicOutputRoot, "index.d.ts"),
  "utf8"
);
ok(classicEntryDeclaration.includes(
  'export {ExportedContract} from "./type_roots/ExportedContract.js"'
));

cpSync(
  path.join(repoRoot, "tests/type-roots/environment.d.ts"),
  path.join(generatedRoot, "environment.d.ts")
);
runGeneratedTypeScriptMatrix("tests/type-roots/tsconfig.json");

const transcript = execFileSync(
  process.execPath,
  ["tests/type-roots/runtime.mjs"],
  { cwd: repoRoot, encoding: "utf8" }
);
ok(transcript.includes("typed-root"));

process.stdout.write(
  "type-roots:ok (ambient typedef pruned; named and exposed contracts retained; TS 5/6/7 + classic)\n"
);
