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
const resolutions = asObject(pkg.resolutions, "package.json resolutions");

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

const apiEngine = toolchains.typescript.apiBridge.programApiEngine;
if (!apiEngine) {
  throw new Error("typescript.apiBridge must declare its delegated Program API engine");
}
ensureSemver(apiEngine.version);
const expectedEngineResolution = `npm:${apiEngine.package}@${apiEngine.version}`;
const actualEngineResolution = asString(
  resolutions[apiEngine.dependency],
  `resolutions.${apiEngine.dependency}`
);
if (actualEngineResolution !== expectedEngineResolution) {
  throw new Error(
    `TypeScript Program API engine resolution mismatch: expected ${expectedEngineResolution}, `
      + `got ${actualEngineResolution}`
  );
}
const installedApiEngine = dependencyPackageJson(apiEngine.dependency);
const installedApiEngineName = asString(
  installedApiEngine.name,
  `${apiEngine.dependency} installed package name`
);
const installedApiEngineVersion = asString(
  installedApiEngine.version,
  `${apiEngine.dependency} installed version`
);
if (installedApiEngineName !== apiEngine.package || installedApiEngineVersion !== apiEngine.version) {
  throw new Error(
    `TypeScript Program API engine mismatch: manifest=${apiEngine.package}@${apiEngine.version}, `
      + `installed=${installedApiEngineName}@${installedApiEngineVersion}`
  );
}

ensureSemver(toolchains.dts2hx.version);
ensureSemver(toolchains.dts2hx.typescriptVersion);
const dts2hxSpec = asString(
  devDependencies[toolchains.dts2hx.dependency],
  `devDependencies.${toolchains.dts2hx.dependency}`
);
if (dts2hxSpec !== toolchains.dts2hx.version) {
  throw new Error(
    `dts2hx dependency mismatch: manifest=${toolchains.dts2hx.version}, `
      + `package.json=${dts2hxSpec}`
  );
}
const installedDts2hxVersion = asString(
  dependencyPackageJson(toolchains.dts2hx.dependency).version,
  "dts2hx installed version"
);
if (installedDts2hxVersion !== toolchains.dts2hx.version) {
  throw new Error(
    `dts2hx install mismatch: manifest=${toolchains.dts2hx.version}, `
      + `installed=${installedDts2hxVersion}`
  );
}
const dts2hxTypescriptPackage = readJson(
  path.join(
    "node_modules",
    toolchains.dts2hx.dependency,
    "node_modules",
    "typescript",
    "package.json"
  )
);
const installedDts2hxTypescript = asString(
  dts2hxTypescriptPackage.version,
  "dts2hx TypeScript installed version"
);
if (installedDts2hxTypescript !== toolchains.dts2hx.typescriptVersion) {
  throw new Error(
    `dts2hx TypeScript mismatch: manifest=${toolchains.dts2hx.typescriptVersion}, `
      + `installed=${installedDts2hxTypescript}`
  );
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

function nodeMajor(value: string, label: string): number {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`Expected ${label} to be a Node major version, got ${value}`);
  }
  return Number(value);
}

function admitsNodeMajor(
  candidate: number,
  supportedFloor: number,
  latestLts: number
): boolean {
  return candidate >= supportedFloor && candidate <= latestLts;
}

/**
 * Exercises the complete manifest-defined boundary on every version-policy run.
 *
 * The hosted matrix proves the two LTS endpoints with real Node installations.
 * These derived cases additionally prove that intervening migration majors are
 * admitted while the immediately older and newer majors fail. Keeping the
 * samples relative to the manifest avoids creating a second list of Node
 * versions that could drift from the policy owner.
 */
function verifyNodeAdmissionBoundary(
  supportedFloor: number,
  latestLts: number
): void {
  const cases: Array<{
    major: number;
    expected: boolean;
    label: string;
  }> = [
    {
      major: supportedFloor - 1,
      expected: false,
      label: "major below the supported floor",
    },
    {
      major: supportedFloor,
      expected: true,
      label: "supported floor",
    },
  ];
  for (let major = supportedFloor + 1; major < latestLts; major += 1) {
    cases.push({
      major,
      expected: true,
      label: "intervening migration major",
    });
  }
  cases.push(
    {
      major: latestLts,
      expected: true,
      label: "latest LTS",
    },
    {
      major: latestLts + 1,
      expected: false,
      label: "unreviewed future major",
    }
  );

  for (const testCase of cases) {
    const actual = admitsNodeMajor(
      testCase.major,
      supportedFloor,
      latestLts
    );
    if (actual !== testCase.expected) {
      throw new Error(
        `Node admission policy rejected its ${testCase.label} case: `
          + `major=${testCase.major}, expected=${testCase.expected}, actual=${actual}`
      );
    }
  }
}

const supportedNodeFloor = nodeMajor(toolchains.node.stable, "node.stable");
const latestNodeLts = nodeMajor(toolchains.node.nextLts, "node.nextLts");
if (supportedNodeFloor >= latestNodeLts) {
  throw new Error(
    `Expected node.stable (${supportedNodeFloor}) to precede node.nextLts (${latestNodeLts})`
  );
}
verifyNodeAdmissionBoundary(supportedNodeFloor, latestNodeLts);

const runningNodeMajor = nodeMajor(
  process.versions.node.split(".")[0],
  "running Node major"
);

// CI owns both LTS endpoints. An intervening odd major may keep a local
// checkout working during migration, but docs do not present it as LTS or as a
// hosted support lane. Future majors still fail until CI deliberately moves
// the upper bound.
if (!admitsNodeMajor(runningNodeMajor, supportedNodeFloor, latestNodeLts)) {
  throw new Error(
    `Node ${process.versions.node} is outside the admitted major range `
      + `${toolchains.node.stable}-${toolchains.node.nextLts}`
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
    + `typescript=${generatedOutputLanes.map(name => `${name}:${toolchains.typescript[name].version}`).join(",")} `
    + `apiEngine=${apiEngine.version} `
    + `dts2hx=${toolchains.dts2hx.version}/ts${toolchains.dts2hx.typescriptVersion}\n`
);
