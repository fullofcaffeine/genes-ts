import { deepStrictEqual, ok } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixtureRoot = path.join(repoRoot, "tests/side-effect-import");
const outputRoot = path.join(fixtureRoot, "out");

/** Runs one deterministic fixture command from the repository root. */
function run(command: string, args: ReadonlyArray<string>): void {
  execFileSync(command, [...args], { cwd: repoRoot, stdio: "inherit" });
}

/** Captures the one-line runtime transcript produced by a generated profile. */
function runtimeTranscript(relativeFile: string): string[] {
  const output = execFileSync(process.execPath, [path.join(repoRoot, relativeFile)], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return output.trim().split(/\r?\n/).filter((line) => line.length > 0);
}

/** Recursively inventories generated artifacts for exact leakage assertions. */
function filesBelow(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(absolute));
    else files.push(absolute);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

rmSync(outputRoot, { recursive: true, force: true });
run("haxe", ["tests/side-effect-import/build-classic.hxml"]);
run("haxe", ["tests/side-effect-import/build-ts.hxml"]);
runGeneratedTypeScriptMatrix("tests/side-effect-import/tsconfig.json");

// This evidence task deliberately freezes the pre-projection failure. The
// compile-time probe above proves typed encounter order is First -> Second,
// while the legacy path-keyed Map currently prints Second -> First. The ordered
// runtime-request task changes this expectation to `first,second`.
deepStrictEqual(runtimeTranscript("tests/side-effect-import/out/classic/index.js"), [
  "second,first"
]);
deepStrictEqual(runtimeTranscript("tests/side-effect-import/out/ts/dist/index.js"), [
  "second,first"
]);

const generatedFiles = filesBelow(outputRoot);
const portableFiles = generatedFiles.map((file) => path.relative(outputRoot, file).split(path.sep).join("/"));
ok(portableFiles.some((file) => file.endsWith("/First.js")), "classic output retains First");
ok(portableFiles.some((file) => file.endsWith("/Second.js")), "classic output retains Second");
ok(portableFiles.some((file) => file.endsWith("/First.ts")), "TS output retains First");
ok(portableFiles.some((file) => file.endsWith("/Second.ts")), "TS output retains Second");
ok(!portableFiles.some((file) => file.includes("DeadTarget")), "unreferenced target remains outside the typed/output graph");

const forbiddenTokens = [
  "SideEffectImportMarker",
  "__ts2hxInit",
  "genes.compilerInternal",
  "sideEffectImportInternal"
];
for (const file of generatedFiles) {
  const content = readFileSync(file, "utf8");
  for (const token of forbiddenTokens) {
    ok(!content.includes(token), `${path.relative(repoRoot, file)} must not expose ${token}`);
  }
}

process.stdout.write(
  `side-effect-import-evidence:ok (${generatedFiles.length} artifacts; typed First->Second; legacy projection Second->First in both profiles)\n`
);
