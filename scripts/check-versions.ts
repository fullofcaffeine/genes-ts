import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findRepoRoot(startDir: string): string {
  let cur = startDir;
  for (let i = 0; i < 8; i += 1) {
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

function readJson(relPath: string): JsonObject {
  const abs = path.join(repoRoot, relPath);
  const text = readFileSync(abs, "utf8");
  return JSON.parse(text) as JsonObject;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${label} to be a non-empty string`);
  }
  return value;
}

function ensureSemver(version: string): void {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid semver: ${version}`);
  }
}

const pkg = readJson("package.json");
const haxelib = readJson("haxelib.json");

const pkgVersion = asString(pkg.version, "package.json version");
const haxeVersion = asString(haxelib.version, "haxelib.json version");

ensureSemver(pkgVersion);
ensureSemver(haxeVersion);

if (pkgVersion !== haxeVersion) {
  throw new Error(`Version mismatch: package.json=${pkgVersion} vs haxelib.json=${haxeVersion}`);
}

console.log(`OK: version=${pkgVersion}`);
