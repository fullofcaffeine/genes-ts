import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function rmrf(relPath: string): void {
  rmSync(path.join(repoRoot, relPath), { recursive: true, force: true });
}

function run(cmd: string, args: ReadonlyArray<string>, opts: ExecFileSyncOptions = {}): void {
  execFileSync(cmd, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...opts
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

rmrf("tests/genes-ts/snapshot/basic/out");
run("haxe", ["-debug", "tests/genes-ts/snapshot/basic/build.hxml"]);

const tsPath = path.join(repoRoot, "tests/genes-ts/snapshot/basic/out/src-gen/Main.ts");
const mapPath = path.join(repoRoot, "tests/genes-ts/snapshot/basic/out/src-gen/Main.ts.map");

if (!existsSync(tsPath)) {
  throw new Error(`Expected generated TS at ${tsPath}`);
}
if (!existsSync(mapPath)) {
  throw new Error(`Expected Haxe→TS sourcemap at ${mapPath}`);
}

const mapUnknown: unknown = JSON.parse(readFileSync(mapPath, "utf8"));
if (!isRecord(mapUnknown)) {
  throw new Error(`Expected sourcemap JSON object, got ${typeof mapUnknown}`);
}

if (mapUnknown.file !== "Main.ts") {
  throw new Error(`Expected sourcemap file to be Main.ts, got ${String(mapUnknown.file)}`);
}

const sources = mapUnknown.sources;
if (!(Array.isArray(sources) && sources.every((s) => typeof s === "string"))) {
  throw new Error(`Expected sourcemap sources to be an array of strings`);
}
if (!sources.includes("../../src/Main.hx")) {
  throw new Error(`Expected sourcemap sources to include ../../src/Main.hx`);
}

const ts = readFileSync(tsPath, "utf8");
if (!ts.includes("//# sourceMappingURL=Main.ts.map")) {
  throw new Error(`Expected generated TS to reference Main.ts.map`);
}

console.log("ok");
