import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findRepoRoot(startDir: string): string {
  let cur = startDir;
  for (let i = 0; i < 10; i += 1) {
    const pkg = path.join(cur, "package.json");
    const haxelib = path.join(cur, "haxelib.json");
    if (existsSync(pkg) && existsSync(haxelib)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error("Failed to locate repo root (package.json + haxelib.json)");
}

const repoRoot = findRepoRoot(__dirname);

function ensureSemver(version: string): void {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid semver: ${version}`);
  }
}

function readJson(relPath: string): { abs: string; original: string; json: JsonObject } {
  const abs = path.join(repoRoot, relPath);
  const original = readFileSync(abs, "utf8");
  const json = JSON.parse(original) as JsonObject;
  return { abs, original, json };
}

function writeJson(abs: string, json: JsonObject, original: string): void {
  const next = `${JSON.stringify(json, null, 2)}\n`;
  if (next !== original) writeFileSync(abs, next, "utf8");
}

function setString(json: JsonObject, key: string, value: string): void {
  json[key] = value;
}

function main(): void {
  const version = process.argv[2];
  if (!version) {
    throw new Error("Usage: node scripts/dist/release/sync-versions.js <version>");
  }
  ensureSemver(version);

  const pkg = readJson("package.json");
  setString(pkg.json, "version", version);
  writeJson(pkg.abs, pkg.json, pkg.original);

  const haxelib = readJson("haxelib.json");
  setString(haxelib.json, "version", version);
  setString(haxelib.json, "releasenote", `v${version}: See CHANGELOG.md`);
  writeJson(haxelib.abs, haxelib.json, haxelib.original);
}

main();
