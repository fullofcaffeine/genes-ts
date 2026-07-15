import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { generatedOutputLanes, repoRoot, toolchains } from "./toolchains.js";

type JsonObject = Record<string, unknown>;

function readJson(relPath: string): JsonObject {
  return JSON.parse(readFileSync(path.join(repoRoot, relPath), "utf8")) as JsonObject;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${label} to be a non-empty string`);
  }
  return value;
}

function asObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }
  return value as JsonObject;
}

function ensureSemver(version: string): void {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid semver: ${version}`);
  }
}

function dependencyPackageJson(dependency: string): JsonObject {
  return readJson(path.join("node_modules", ...dependency.split("/"), "package.json"));
}

function walkFiles(relDir: string, predicate: (relPath: string) => boolean): string[] {
  const results: string[] = [];
  function visit(current: string): void {
    for (const entry of readdirSync(path.join(repoRoot, current))) {
      if (["dist", "out", ".tmp", "node_modules"].includes(entry)) continue;
      const relPath = path.join(current, entry);
      const stat = statSync(path.join(repoRoot, relPath));
      if (stat.isDirectory()) visit(relPath);
      else if (predicate(relPath)) results.push(relPath);
    }
  }
  visit(relDir);
  return results.sort();
}

function assertNoDuplicatedToolchainLiterals(): void {
  const roots = ["scripts", "tools/ts2hx", "tests/genes-ts/repros", ".github/workflows"];
  const sourceFiles = roots.flatMap(root => walkFiles(root, relPath =>
    /\.(?:ts|mjs|yml|yaml|json)$/.test(relPath)
  ));
  const offenders: string[] = [];
  for (const relPath of sourceFiles) {
    const source = readFileSync(path.join(repoRoot, relPath), "utf8");
    if (/typescript@[0-9]+\.[0-9]+\.[0-9]+/.test(source)
      || /node_modules[/\\]typescript[/\\]bin[/\\]tsc/.test(source)) {
      offenders.push(relPath);
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `Toolchain versions must come from config/toolchains.json: ${offenders.join(", ")}`
    );
  }

  const directApiImports = sourceFiles.filter(relPath => {
    const source = readFileSync(path.join(repoRoot, relPath), "utf8");
    return /from ["']typescript["']/.test(source)
      && !["scripts/typescript-api.ts", "tools/ts2hx/src/typescript-api.ts"].includes(relPath);
  });
  if (directApiImports.length > 0) {
    throw new Error(
      `TypeScript Program API imports must use an adapter: ${directApiImports.join(", ")}`
    );
  }
}

function assertModernTsconfigs(): void {
  const roots = ["tests", "examples", "tools/ts2hx"];
  const configs = roots.flatMap(root => walkFiles(root, relPath =>
    path.basename(relPath).startsWith("tsconfig") && relPath.endsWith(".json")
  ));
  const baseUrlConfigs = configs.filter(relPath =>
    /"baseUrl"\s*:/.test(readFileSync(path.join(repoRoot, relPath), "utf8"))
  );
  if (baseUrlConfigs.length > 0) {
    throw new Error(`TypeScript 7 removed baseUrl; found it in ${baseUrlConfigs.join(", ")}`);
  }
}

const pkg = readJson("package.json");
const haxelib = readJson("haxelib.json");
const devDependencies = asObject(pkg.devDependencies, "package.json devDependencies");

const pkgVersion = asString(pkg.version, "package.json version");
const haxelibVersion = asString(haxelib.version, "haxelib.json version");
ensureSemver(pkgVersion);
ensureSemver(haxelibVersion);
if (pkgVersion !== haxelibVersion) {
  throw new Error(
    `Version mismatch: package.json=${pkgVersion} vs haxelib.json=${haxelibVersion}`
  );
}

for (const laneName of generatedOutputLanes) {
  const lane = toolchains.typescript[laneName];
  ensureSemver(lane.version);
  const expectedSpec = `npm:${lane.package}@${lane.version}`;
  const actualSpec = asString(
    devDependencies[lane.dependency],
    `devDependencies.${lane.dependency}`
  );
  if (actualSpec !== expectedSpec) {
    throw new Error(
      `${laneName} dependency mismatch: expected ${expectedSpec}, got ${actualSpec}`
    );
  }
  const installedVersion = asString(
    dependencyPackageJson(lane.dependency).version,
    `${lane.dependency} installed version`
  );
  if (installedVersion !== lane.version) {
    throw new Error(
      `${laneName} install mismatch: manifest=${lane.version}, installed=${installedVersion}`
    );
  }
}

ensureSemver(toolchains.haxe.stable);
ensureSemver(toolchains.haxe.preview);
const haxerc = readJson(".haxerc");
const haxercVersion = asString(haxerc.version, ".haxerc version");
if (haxercVersion !== toolchains.haxe.stable) {
  throw new Error(
    `.haxerc=${haxercVersion}, manifest stable Haxe=${toolchains.haxe.stable}`
  );
}

const nodeMajor = process.versions.node.split(".")[0];
if (![toolchains.node.stable, toolchains.node.nextLts].includes(nodeMajor)) {
  throw new Error(
    `Node ${process.versions.node} is outside manifest lanes ${toolchains.node.stable}/${toolchains.node.nextLts}`
  );
}

for (const workflow of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
  const source = readFileSync(path.join(repoRoot, workflow), "utf8");
  if (!source.includes("scripts/emit-toolchain-outputs.mjs")) {
    throw new Error(`${workflow} must consume config/toolchains.json`);
  }
}

assertNoDuplicatedToolchainLiterals();
assertModernTsconfigs();

process.stdout.write(
  `versions:ok package=${pkgVersion} haxe=${toolchains.haxe.stable} `
    + `typescript=${generatedOutputLanes.map(name => `${name}:${toolchains.typescript[name].version}`).join(",")}\n`
);
