import assert from "node:assert/strict";
import {
  mkdirSync,
  lstatSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import {
  INSTALLED_PACKAGE_RESOLUTION_PROFILE,
  InstalledPackageClosureError,
  measureInstalledPackageClosure,
  measureInstalledPackageClosureWithHooks,
  type InstalledPackageClosureLimits,
  type InstalledPackageClosureMeasurement,
  type InstalledPackageClosureRequest,
  type InstalledPackageRoot,
} from "./css-modules/installed-package-closure.js";

const LIMITS: InstalledPackageClosureLimits = Object.freeze({
  maxPackages: 32,
  maxEdges: 64,
  maxEntries: 256,
  maxFiles: 128,
  maxBytes: 1024 * 1024,
  maxPathBytes: 256,
});

interface PackageOptions {
  readonly name: string;
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<
    Record<string, Readonly<{ readonly optional?: boolean }>>
  >;
  readonly entry?: string | null;
  readonly extraMetadata?: Readonly<Record<string, unknown>>;
  readonly packageJsonPrefix?: string;
  readonly packageJsonText?: string;
  readonly files?: Readonly<Record<string, string>>;
}

function write(absolute: string, bytes: string): void {
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, bytes, "utf8");
}

function createPackage(root: string, options: PackageOptions): string {
  const entry = options.entry === undefined ? "index.cjs" : options.entry;
  const metadata = {
    name: options.name,
    version: options.version ?? "1.0.0",
    ...(entry === null ? {} : { main: entry }),
    ...(options.dependencies === undefined
      ? {}
      : { dependencies: options.dependencies }),
    ...(options.optionalDependencies === undefined
      ? {}
      : { optionalDependencies: options.optionalDependencies }),
    ...(options.peerDependencies === undefined
      ? {}
      : { peerDependencies: options.peerDependencies }),
    ...(options.peerDependenciesMeta === undefined
      ? {}
      : { peerDependenciesMeta: options.peerDependenciesMeta }),
    ...options.extraMetadata,
  };
  write(
    path.join(root, "package.json"),
    options.packageJsonText ??
      `${options.packageJsonPrefix ?? ""}${JSON.stringify(metadata, null, 2)}\n`,
  );
  if (entry !== null) {
    write(
      path.join(root, entry),
      options.files?.[entry] ??
        `module.exports = ${JSON.stringify(options.name)};\n`,
    );
  }
  for (const [relative, bytes] of Object.entries(options.files ?? {})) {
    if (relative !== entry) write(path.join(root, relative), bytes);
  }
  return root;
}

function projectRoot(prefix: string): string {
  const root = realpathSync.native(
    mkdtempSync(path.join(realpathSync.native(tmpdir()), prefix)),
  );
  write(path.join(root, "anchor.mjs"), "export {};\n");
  return root;
}

function packageRoot(project: string, packageName: string): string {
  return path.join(project, "node_modules", ...packageName.split("/"));
}

function request(
  project: string,
  packageName: string,
  providerKind = "genes.test.processor",
  limits: InstalledPackageClosureLimits = LIMITS,
  root: InstalledPackageRoot = {
    packageName,
    expectedVersion: "1.0.0",
  },
): InstalledPackageClosureRequest {
  return Object.freeze({
    providerKind,
    resolutionProfile: INSTALLED_PACKAGE_RESOLUTION_PROFILE,
    resolutionBaseUrl: pathToFileURL(path.join(project, "anchor.mjs")).href,
    roots: Object.freeze([Object.freeze(root)]),
    limits,
  });
}

function expectFailure(
  code: InstalledPackageClosureError["code"],
  subject: string,
  action: () => unknown,
  forbiddenPath?: string,
): void {
  assert.throws(action, (error: unknown) => {
    return (
      error instanceof InstalledPackageClosureError &&
      error.code === code &&
      error.subject === subject &&
      (forbiddenPath === undefined || !error.message.includes(forbiddenPath))
    );
  });
}

function graphFixture(project: string, nested: boolean): void {
  const root = createPackage(packageRoot(project, "fixture-root"), {
    name: "fixture-root",
    dependencies: { "fixture-dependency": "1.0.0" },
    files: { "lib/value.cjs": 'module.exports = "root-value";\n' },
  });
  createPackage(
    nested
      ? path.join(root, "node_modules", "fixture-dependency")
      : packageRoot(project, "fixture-dependency"),
    {
      name: "fixture-dependency",
      files: { "lib/value.cjs": 'module.exports = "dependency-value";\n' },
    },
  );
}

function comparableCounts(
  measurement: InstalledPackageClosureMeasurement,
): Readonly<Record<string, number>> {
  return Object.freeze({
    packages: measurement.packageCount,
    edges: measurement.edgeCount,
    files: measurement.fileCount,
    bytes: measurement.totalBytes,
  });
}

const temporaryRoots: string[] = [];
try {
  assert.equal(process.env.NODE_OPTIONS ?? "", "");
  assert.equal(process.env.NODE_PATH ?? "", "");
  assert.equal(process.env.NODE_PRESERVE_SYMLINKS_MAIN ?? "", "");

  const hoisted = projectRoot("genes-package-hoisted-");
  const nested = projectRoot("genes-package-nested-");
  temporaryRoots.push(hoisted, nested);
  graphFixture(hoisted, false);
  graphFixture(nested, true);
  const hoistedMeasurement = measureInstalledPackageClosure(
    request(hoisted, "fixture-root"),
  );
  const nestedMeasurement = measureInstalledPackageClosure(
    request(nested, "fixture-root"),
  );
  assert.match(
    hoistedMeasurement.installedClosureIntegrity,
    /^sha256-[A-Za-z0-9+/]{43}=$/u,
  );
  assert.equal(
    hoistedMeasurement.installedClosureIntegrity,
    nestedMeasurement.installedClosureIntegrity,
    "equivalent runtime graphs ignore physical hoisting",
  );
  assert.deepEqual(
    comparableCounts(hoistedMeasurement),
    comparableCounts(nestedMeasurement),
  );
  assert.equal(hoistedMeasurement.packageCount, 2);
  assert.equal(hoistedMeasurement.edgeCount, 1);

  const multipleRoots = [
    { packageName: "fixture-root", expectedVersion: "1.0.0" },
    { packageName: "fixture-dependency", expectedVersion: "1.0.0" },
  ] as const;
  const baseRequest = request(hoisted, "fixture-root");
  const forwardRoots = measureInstalledPackageClosure({
    ...baseRequest,
    roots: multipleRoots,
  });
  const reverseRoots = measureInstalledPackageClosure({
    ...baseRequest,
    roots: [...multipleRoots].reverse(),
  });
  assert.equal(
    forwardRoots.installedClosureIntegrity,
    reverseRoots.installedClosureIntegrity,
  );

  const byteChanged = projectRoot("genes-package-byte-");
  temporaryRoots.push(byteChanged);
  graphFixture(byteChanged, false);
  write(
    path.join(
      packageRoot(byteChanged, "fixture-dependency"),
      "lib/value.cjs",
    ),
    'module.exports = "changed";\n',
  );
  assert.notEqual(
    measureInstalledPackageClosure(request(byteChanged, "fixture-root"))
      .installedClosureIntegrity,
    hoistedMeasurement.installedClosureIntegrity,
  );

  const edgeChanged = projectRoot("genes-package-edge-");
  temporaryRoots.push(edgeChanged);
  const edgeRoot = createPackage(packageRoot(edgeChanged, "fixture-root"), {
    name: "fixture-root",
    dependencies: { "fixture-dependency": "1.0.0" },
    files: { "lib/value.cjs": 'module.exports = "root-value";\n' },
  });
  createPackage(path.join(edgeRoot, "node_modules", "fixture-dependency"), {
    name: "fixture-dependency",
    version: "2.0.0",
    files: { "lib/value.cjs": 'module.exports = "dependency-value";\n' },
  });
  assert.notEqual(
    measureInstalledPackageClosure(request(edgeChanged, "fixture-root"))
      .installedClosureIntegrity,
    hoistedMeasurement.installedClosureIntegrity,
  );

  const optionalAbsent = projectRoot("genes-package-optional-absent-");
  const optionalPresent = projectRoot("genes-package-optional-present-");
  temporaryRoots.push(optionalAbsent, optionalPresent);
  for (const project of [optionalAbsent, optionalPresent]) {
    createPackage(packageRoot(project, "optional-root"), {
      name: "optional-root",
      optionalDependencies: { "optional-runtime": "" },
    });
  }
  createPackage(packageRoot(optionalPresent, "optional-runtime"), {
    name: "optional-runtime",
    entry: null,
    files: { "feature.js": 'module.exports = "PRESENT";\n' },
  });
  const absentMeasurement = measureInstalledPackageClosure(
    request(optionalAbsent, "optional-root"),
  );
  const presentMeasurement = measureInstalledPackageClosure(
    request(optionalPresent, "optional-root"),
  );
  assert.equal(absentMeasurement.packageCount, 1);
  assert.equal(presentMeasurement.packageCount, 2);
  assert.notEqual(
    absentMeasurement.installedClosureIntegrity,
    presentMeasurement.installedClosureIntegrity,
    "subpath-only optional presence changes installed closure evidence",
  );

  const mandatorySubpath = projectRoot("genes-package-subpath-mandatory-");
  temporaryRoots.push(mandatorySubpath);
  createPackage(packageRoot(mandatorySubpath, "subpath-root"), {
    name: "subpath-root",
    dependencies: { "subpath-runtime": "" },
  });
  createPackage(packageRoot(mandatorySubpath, "subpath-runtime"), {
    name: "subpath-runtime",
    entry: null,
    files: { "feature.js": 'module.exports = "PRESENT";\n' },
  });
  const emptySpecificationMeasurement = measureInstalledPackageClosure(
    request(mandatorySubpath, "subpath-root"),
  );
  assert.equal(emptySpecificationMeasurement.packageCount, 2);
  createPackage(packageRoot(mandatorySubpath, "subpath-root"), {
    name: "subpath-root",
    dependencies: { "subpath-runtime": "*" },
  });
  assert.notEqual(
    measureInstalledPackageClosure(request(mandatorySubpath, "subpath-root"))
      .installedClosureIntegrity,
    emptySpecificationMeasurement.installedClosureIntegrity,
  );

  const importOnly = projectRoot("genes-package-import-only-");
  temporaryRoots.push(importOnly);
  createPackage(packageRoot(importOnly, "import-root"), {
    name: "import-root",
    entry: null,
    extraMetadata: {
      type: "module",
      exports: { ".": { import: "./index.mjs" } },
    },
    files: { "index.mjs": 'export default "IMPORT";\n' },
  });
  assert.equal(
    measureInstalledPackageClosure(request(importOnly, "import-root"))
      .packageCount,
    1,
  );

  const aliasProject = projectRoot("genes-package-alias-");
  temporaryRoots.push(aliasProject);
  createPackage(packageRoot(aliasProject, "alias-root"), {
    name: "alias-root",
    dependencies: { alias: "file:../actual-runtime" },
  });
  createPackage(packageRoot(aliasProject, "alias"), {
    name: "actual-runtime",
  });
  assert.equal(
    measureInstalledPackageClosure(request(aliasProject, "alias-root"))
      .packageCount,
    2,
    "logical dependency keys do not invent installed metadata names",
  );

  const malformedOptional = projectRoot("genes-package-malformed-optional-");
  temporaryRoots.push(malformedOptional);
  createPackage(packageRoot(malformedOptional, "optional-root"), {
    name: "optional-root",
    optionalDependencies: { "optional-runtime": "1.0.0" },
  });
  createPackage(packageRoot(malformedOptional, "optional-runtime"), {
    name: "optional-runtime",
    packageJsonText: "{ invalid json\n",
  });
  expectFailure(
    "package-metadata-invalid",
    "optional-root:optional-runtime",
    () =>
      measureInstalledPackageClosure(
        request(malformedOptional, "optional-root"),
      ),
    malformedOptional,
  );

  const peerAbsent = projectRoot("genes-package-peer-absent-");
  const peerPresent = projectRoot("genes-package-peer-present-");
  temporaryRoots.push(peerAbsent, peerPresent);
  for (const project of [peerAbsent, peerPresent]) {
    createPackage(packageRoot(project, "peer-root"), {
      name: "peer-root",
      peerDependencies: { "peer-runtime": "" },
      peerDependenciesMeta: { "peer-runtime": { optional: true } },
    });
  }
  createPackage(packageRoot(peerPresent, "peer-runtime"), {
    name: "peer-runtime",
  });
  const peerAbsentMeasurement = measureInstalledPackageClosure(
    request(peerAbsent, "peer-root"),
  );
  const peerPresentMeasurement = measureInstalledPackageClosure(
    request(peerPresent, "peer-root"),
  );
  assert.equal(peerAbsentMeasurement.packageCount, 1);
  assert.equal(peerPresentMeasurement.packageCount, 2);
  assert.notEqual(
    peerAbsentMeasurement.installedClosureIntegrity,
    peerPresentMeasurement.installedClosureIntegrity,
  );

  const metadataOnlyPeer = projectRoot("genes-package-peer-metadata-only-");
  temporaryRoots.push(metadataOnlyPeer);
  createPackage(packageRoot(metadataOnlyPeer, "peer-root"), {
    name: "peer-root",
    peerDependenciesMeta: { "undeclared-peer": { optional: true } },
  });
  const metadataOnlyPeerMeasurement = measureInstalledPackageClosure(
    request(metadataOnlyPeer, "peer-root"),
  );
  assert.equal(metadataOnlyPeerMeasurement.packageCount, 1);
  assert.equal(metadataOnlyPeerMeasurement.edgeCount, 0);

  const excessivePeerMetadata = projectRoot(
    "genes-package-peer-metadata-limit-",
  );
  temporaryRoots.push(excessivePeerMetadata);
  createPackage(packageRoot(excessivePeerMetadata, "peer-root"), {
    name: "peer-root",
    peerDependenciesMeta: {
      "metadata-a": { optional: true },
      "metadata-b": { optional: true },
      "metadata-c": { optional: true },
    },
  });
  expectFailure("package-closure-limit", "maxEdges", () => {
    measureInstalledPackageClosure(
      request(excessivePeerMetadata, "peer-root", "genes.test.processor", {
        ...LIMITS,
        maxEdges: 2,
      }),
    );
  });

  const pollutedPeerMetadata = projectRoot(
    "genes-package-peer-metadata-prototype-",
  );
  temporaryRoots.push(pollutedPeerMetadata);
  const inheritedMetadataProbe = "genes-inherited-metadata-probe";
  let inheritedMetadataVisits = 0;
  const hasOwnDescriptor = Object.getOwnPropertyDescriptor(Object, "hasOwn")!;
  const originalHasOwn = Object.hasOwn;
  assert.equal(Object.hasOwn(Object.prototype, "optional"), false);
  assert.equal(Object.hasOwn(Object.prototype, inheritedMetadataProbe), false);
  Object.defineProperty(Object.prototype, "optional", {
    configurable: true,
    enumerable: true,
    value: true,
  });
  Object.defineProperty(Object.prototype, inheritedMetadataProbe, {
    configurable: true,
    enumerable: true,
    value: "polluted",
  });
  Object.defineProperty(Object, "hasOwn", {
    configurable: true,
    writable: true,
    value: (value: object, key: PropertyKey): boolean => {
      const result = originalHasOwn(value, key);
      if (!result && key === inheritedMetadataProbe) inheritedMetadataVisits += 1;
      return result;
    },
  });
  try {
    createPackage(packageRoot(pollutedPeerMetadata, "peer-root"), {
      name: "peer-root",
      peerDependencies: { "peer-runtime": "1.0.0" },
      peerDependenciesMeta: { "peer-runtime": {} },
    });
    expectFailure(
      "package-unavailable",
      "peer-root:peer-runtime",
      () =>
        measureInstalledPackageClosure(
          request(pollutedPeerMetadata, "peer-root"),
        ),
    );
    assert.equal(inheritedMetadataVisits, 0);
  } finally {
    Object.defineProperty(Object, "hasOwn", hasOwnDescriptor);
    assert.equal(Reflect.deleteProperty(Object.prototype, "optional"), true);
    assert.equal(
      Reflect.deleteProperty(Object.prototype, inheritedMetadataProbe),
      true,
    );
  }

  const deepUnrelatedMetadata = projectRoot(
    "genes-package-deep-unrelated-metadata-",
  );
  temporaryRoots.push(deepUnrelatedMetadata);
  const nestedArrayDepth = 3_000;
  createPackage(packageRoot(deepUnrelatedMetadata, "deep-root"), {
    name: "deep-root",
    packageJsonText:
      `{"name":"deep-root","version":"1.0.0","unrelated":` +
      `${"[".repeat(nestedArrayDepth)}0${"]".repeat(nestedArrayDepth)}}\n`,
  });
  const deepUnrelatedMeasurement = measureInstalledPackageClosure(
    request(deepUnrelatedMetadata, "deep-root"),
  );
  assert.equal(deepUnrelatedMeasurement.packageCount, 1);
  assert.equal(deepUnrelatedMeasurement.edgeCount, 0);

  const mandatoryPeer = projectRoot("genes-package-peer-mandatory-");
  temporaryRoots.push(mandatoryPeer);
  createPackage(packageRoot(mandatoryPeer, "peer-root"), {
    name: "peer-root",
    peerDependencies: { "peer-runtime": "1.0.0" },
  });
  expectFailure(
    "package-unavailable",
    "peer-root:peer-runtime",
    () => measureInstalledPackageClosure(request(mandatoryPeer, "peer-root")),
  );

  const linkedProject = projectRoot("genes-package-root-link-");
  const directProject = projectRoot("genes-package-root-direct-");
  temporaryRoots.push(linkedProject, directProject);
  createPackage(packageRoot(directProject, "linked-root"), {
    name: "linked-root",
  });
  const storeRoot = createPackage(
    path.join(linkedProject, "package-store", "linked-root"),
    { name: "linked-root" },
  );
  mkdirSync(path.dirname(packageRoot(linkedProject, "linked-root")), {
    recursive: true,
  });
  symlinkSync(storeRoot, packageRoot(linkedProject, "linked-root"), "dir");
  assert.equal(
    measureInstalledPackageClosure(request(linkedProject, "linked-root"))
      .installedClosureIntegrity,
    measureInstalledPackageClosure(request(directProject, "linked-root"))
      .installedClosureIntegrity,
  );

  const internalLink = projectRoot("genes-package-internal-link-");
  temporaryRoots.push(internalLink);
  const internalRoot = createPackage(packageRoot(internalLink, "internal-link"), {
    name: "internal-link",
  });
  symlinkSync("index.cjs", path.join(internalRoot, "linked.cjs"));
  expectFailure(
    "package-symlink-unsupported",
    "internal-link:linked.cjs",
    () =>
      measureInstalledPackageClosure(
        request(internalLink, "internal-link"),
      ),
  );

  const cycleProject = projectRoot("genes-package-cycle-");
  temporaryRoots.push(cycleProject);
  const cycleRoot = createPackage(packageRoot(cycleProject, "cycle-root"), {
    name: "cycle-root",
    dependencies: { "cycle-child": "1.0.0" },
  });
  createPackage(path.join(cycleRoot, "node_modules", "cycle-child"), {
    name: "cycle-child",
    dependencies: { "cycle-root": "1.0.0" },
  });
  const cycleMeasurement = measureInstalledPackageClosure(
    request(cycleProject, "cycle-root"),
  );
  assert.equal(cycleMeasurement.packageCount, 2);
  assert.equal(cycleMeasurement.edgeCount, 2);

  const duplicateProject = projectRoot("genes-package-duplicate-");
  const deduplicatedProject = projectRoot("genes-package-deduplicated-");
  temporaryRoots.push(duplicateProject, deduplicatedProject);
  const duplicateRoot = createPackage(
    packageRoot(duplicateProject, "duplicate-root"),
    {
      name: "duplicate-root",
      dependencies: { left: "1.0.0", right: "1.0.0" },
    },
  );
  for (const side of ["left", "right"] as const) {
    const sideRoot = createPackage(path.join(duplicateRoot, "node_modules", side), {
      name: side,
      dependencies: { shared: "1.0.0" },
    });
    createPackage(path.join(sideRoot, "node_modules", "shared"), {
      name: "shared",
    });
  }
  const deduplicatedRoot = createPackage(
    packageRoot(deduplicatedProject, "duplicate-root"),
    {
      name: "duplicate-root",
      dependencies: { left: "1.0.0", right: "1.0.0" },
    },
  );
  for (const side of ["left", "right"] as const) {
    createPackage(path.join(deduplicatedRoot, "node_modules", side), {
      name: side,
      dependencies: { shared: "1.0.0" },
    });
  }
  createPackage(packageRoot(deduplicatedProject, "shared"), {
    name: "shared",
  });
  const duplicateMeasurement = measureInstalledPackageClosure(
    request(duplicateProject, "duplicate-root"),
  );
  const deduplicatedMeasurement = measureInstalledPackageClosure(
    request(deduplicatedProject, "duplicate-root"),
  );
  assert.equal(duplicateMeasurement.packageCount, 5);
  assert.equal(deduplicatedMeasurement.packageCount, 4);
  assert.notEqual(
    duplicateMeasurement.installedClosureIntegrity,
    deduplicatedMeasurement.installedClosureIntegrity,
    "equal package bytes at distinct installed roots retain distinct identity",
  );

  expectFailure(
    "package-closure-limit",
    "maxPackages",
    () =>
      measureInstalledPackageClosure(
        request(hoisted, "fixture-root", "genes.test.processor", {
          ...LIMITS,
          maxPackages: 1,
        }),
      ),
  );
  for (const [limit, value, project] of [
    ["maxEdges", 1, cycleProject],
    ["maxEntries", 1, hoisted],
    ["maxFiles", 1, hoisted],
    ["maxBytes", 1, hoisted],
    ["maxPathBytes", 1, hoisted],
  ] as const) {
    const rootName = project === cycleProject ? "cycle-root" : "fixture-root";
    expectFailure("package-closure-limit", limit, () => {
      measureInstalledPackageClosure(
        request(project, rootName, "genes.test.processor", {
          ...LIMITS,
          [limit]: value,
        }),
      );
    });
  }

  const declaredEdgeLimit = projectRoot("genes-package-declared-edge-limit-");
  temporaryRoots.push(declaredEdgeLimit);
  createPackage(packageRoot(declaredEdgeLimit, "edge-root"), {
    name: "edge-root",
    dependencies: {
      "missing-a": "1.0.0",
      "missing-b": "1.0.0",
      "missing-c": "1.0.0",
    },
  });
  expectFailure(
    "package-closure-limit",
    "maxEdges",
    () =>
      measureInstalledPackageClosure(
        request(declaredEdgeLimit, "edge-root", "genes.test.processor", {
          ...LIMITS,
          maxEdges: 2,
        }),
      ),
  );

  const cumulativeMetadataWork = projectRoot(
    "genes-package-cumulative-metadata-work-",
  );
  temporaryRoots.push(cumulativeMetadataWork);
  createPackage(packageRoot(cumulativeMetadataWork, "edge-root"), {
    name: "edge-root",
    dependencies: { a: "1", b: "1" },
    optionalDependencies: { a: "1", b: "1" },
  });
  expectFailure(
    "package-closure-limit",
    "maxEdges",
    () =>
      measureInstalledPackageClosure(
        request(cumulativeMetadataWork, "edge-root", "genes.test.processor", {
          ...LIMITS,
          maxEdges: 2,
        }),
      ),
  );

  const exactCeiling = projectRoot("genes-package-exact-ceiling-");
  temporaryRoots.push(exactCeiling);
  createPackage(packageRoot(exactCeiling, "ceiling-root"), {
    name: "ceiling-root",
    files: { "zz-empty": "" },
  });
  const ceilingBaseline = measureInstalledPackageClosure(
    request(exactCeiling, "ceiling-root"),
  );
  const ceilingAtLimit = measureInstalledPackageClosure(
    request(exactCeiling, "ceiling-root", "genes.test.processor", {
      ...LIMITS,
      maxBytes: ceilingBaseline.totalBytes,
    }),
  );
  assert.equal(ceilingAtLimit.totalBytes, ceilingBaseline.totalBytes);

  const metadataBudget = projectRoot("genes-package-metadata-budget-");
  temporaryRoots.push(metadataBudget);
  const metadataRootText = `${JSON.stringify({
    name: "metadata-root",
    version: "1.0.0",
    dependencies: { "metadata-child": "1.0.0" },
  }, null, 2)}\n`;
  const metadataChildText = `${JSON.stringify({
    name: "metadata-child",
    version: "1.0.0",
  }, null, 2)}\n`;
  createPackage(packageRoot(metadataBudget, "metadata-root"), {
    name: "metadata-root",
    entry: null,
    packageJsonText: metadataRootText,
  });
  createPackage(packageRoot(metadataBudget, "metadata-child"), {
    name: "metadata-child",
    entry: null,
    packageJsonText: metadataChildText,
  });
  const exactMetadataBytes =
    Buffer.byteLength(metadataRootText) + Buffer.byteLength(metadataChildText);
  const metadataMeasurement = measureInstalledPackageClosure(
    request(metadataBudget, "metadata-root", "genes.test.processor", {
      ...LIMITS,
      maxBytes: exactMetadataBytes,
    }),
  );
  assert.equal(metadataMeasurement.totalBytes, exactMetadataBytes);
  expectFailure("package-closure-limit", "maxBytes", () => {
    measureInstalledPackageClosure(
      request(metadataBudget, "metadata-root", "genes.test.processor", {
        ...LIMITS,
        maxBytes: exactMetadataBytes - 1,
      }),
    );
  });

  const metadataCeiling = projectRoot("genes-package-metadata-ceiling-");
  temporaryRoots.push(metadataCeiling);
  const metadataPrefix =
    '{"name":"metadata-root","version":"1.0.0","padding":"';
  const metadataSuffix = '"}';
  const oneMiB = 1024 * 1024;
  const exactMetadataDocument =
    metadataPrefix +
    "a".repeat(oneMiB - metadataPrefix.length - metadataSuffix.length) +
    metadataSuffix;
  createPackage(packageRoot(metadataCeiling, "metadata-root"), {
    name: "metadata-root",
    entry: null,
    packageJsonText: exactMetadataDocument,
  });
  assert.equal(
    measureInstalledPackageClosure(
      request(metadataCeiling, "metadata-root", "genes.test.processor", {
        ...LIMITS,
        maxBytes: oneMiB,
      }),
    ).totalBytes,
    oneMiB,
  );
  writeFileSync(
    path.join(packageRoot(metadataCeiling, "metadata-root"), "package.json"),
    exactMetadataDocument.slice(0, -metadataSuffix.length) +
      "a" +
      metadataSuffix,
    "utf8",
  );
  const originalJsonParse = JSON.parse;
  let oversizedJsonParseCalls = 0;
  Object.defineProperty(JSON, "parse", {
    configurable: true,
    writable: true,
    value: (...arguments_: Parameters<typeof JSON.parse>): unknown => {
      oversizedJsonParseCalls += 1;
      return originalJsonParse(...arguments_);
    },
  });
  try {
    expectFailure("package-closure-limit", "maxPackageMetadataBytes", () => {
      measureInstalledPackageClosure(
        request(metadataCeiling, "metadata-root", "genes.test.processor", {
          ...LIMITS,
          maxBytes: 2 * oneMiB,
        }),
      );
    });
    assert.equal(oversizedJsonParseCalls, 0);
    expectFailure("package-closure-limit", "maxBytes", () => {
      measureInstalledPackageClosure(
        request(metadataCeiling, "metadata-root", "genes.test.processor", {
          ...LIMITS,
          maxBytes: oneMiB - 1,
        }),
      );
    });
  } finally {
    Object.defineProperty(JSON, "parse", {
      configurable: true,
      writable: true,
      value: originalJsonParse,
    });
  }

  const retainedPaths = projectRoot("genes-package-retained-paths-");
  temporaryRoots.push(retainedPaths);
  createPackage(packageRoot(retainedPaths, "path-root"), {
    name: "path-root",
    entry: null,
    files: { a: "" },
  });
  measureInstalledPackageClosureWithHooks(
    request(retainedPaths, "path-root"),
    { maxRetainedPathBytes: 13 },
  );
  expectFailure("package-closure-limit", "maxRetainedPathBytes", () => {
    measureInstalledPackageClosureWithHooks(
      request(retainedPaths, "path-root"),
      { maxRetainedPathBytes: 12 },
    );
  });

  expectFailure(
    "invalid-request",
    "limits",
    () =>
      measureInstalledPackageClosure(
        request(hoisted, "fixture-root", "genes.test.processor", {
          ...LIMITS,
          maxPackages: 513,
        }),
      ),
  );
  expectFailure(
    "invalid-request",
    "resolutionBaseUrl",
    () =>
      measureInstalledPackageClosure({
        ...request(hoisted, "fixture-root"),
        resolutionBaseUrl: "file://example.com/tmp/anchor.mjs",
      }),
  );
  expectFailure(
    "invalid-request",
    "resolutionBaseUrl",
    () =>
      measureInstalledPackageClosure({
        ...request(hoisted, "fixture-root"),
        resolutionBaseUrl: "a".repeat(4 * 4096 + 65),
      }),
  );
  expectFailure(
    "invalid-request",
    "roots",
    () =>
      measureInstalledPackageClosure({
        ...request(hoisted, "fixture-root"),
        roots: [{ packageName: "../fixture-root", expectedVersion: "1.0.0" }],
      }),
  );
  for (const invalidPackageKey of ["scheme:value", "encoded%value"]) {
    expectFailure("invalid-request", "roots", () => {
      measureInstalledPackageClosure({
        ...request(hoisted, "fixture-root"),
        roots: [{
          packageName: invalidPackageKey,
          expectedVersion: "1.0.0",
        }],
      });
    });
  }

  const legacyKeys = projectRoot("genes-package-legacy-keys-");
  temporaryRoots.push(legacyKeys);
  const legacyRootName = "legacy!*'()";
  createPackage(packageRoot(legacyKeys, legacyRootName), {
    name: legacyRootName,
    optionalDependencies: {
      "optional!": "",
      "optional*": "",
      "optional'": "",
      "optional(": "",
      "optional)": "",
    },
  });
  assert.equal(
    measureInstalledPackageClosure(request(legacyKeys, legacyRootName))
      .packageCount,
    1,
  );
  const scopedLegacyRoot = "@scope!/name*'()";
  createPackage(packageRoot(legacyKeys, scopedLegacyRoot), {
    name: scopedLegacyRoot,
  });
  assert.equal(
    measureInstalledPackageClosure(request(legacyKeys, scopedLegacyRoot))
      .packageCount,
    1,
  );

  expectFailure(
    "invalid-request",
    "providerKind",
    () =>
      measureInstalledPackageClosure(
        request(hoisted, "fixture-root", ""),
      ),
  );
  expectFailure(
    "invalid-request",
    "providerKind",
    () =>
      measureInstalledPackageClosure(
        request(hoisted, "fixture-root", "a".repeat(513)),
      ),
  );
  expectFailure(
    "invalid-request",
    "providerKind",
    () =>
      measureInstalledPackageClosure(
        request(hoisted, "fixture-root", "\uD800"),
      ),
  );
  expectFailure(
    "package-version-mismatch",
    "fixture-root",
    () =>
      measureInstalledPackageClosure({
        ...request(hoisted, "fixture-root"),
        roots: [{ packageName: "fixture-root", expectedVersion: "9.9.9" }],
      }),
  );
  assert.notEqual(
    measureInstalledPackageClosure(
      request(hoisted, "fixture-root", "genes.test.other-processor"),
    ).installedClosureIntegrity,
    hoistedMeasurement.installedClosureIntegrity,
  );

  const bomProject = projectRoot("genes-package-bom-");
  temporaryRoots.push(bomProject);
  createPackage(packageRoot(bomProject, "bom-root"), {
    name: "bom-root",
    packageJsonPrefix: "\uFEFF",
  });
  assert.equal(
    measureInstalledPackageClosure(request(bomProject, "bom-root")).packageCount,
    1,
  );

  const unsafeNameProject = projectRoot("genes-package-unsafe-name-");
  temporaryRoots.push(unsafeNameProject);
  createPackage(packageRoot(unsafeNameProject, "unsafe-name-root"), {
    name: "unsafe-name-root",
    files: { "unsafe-\uFFFD.js": "export {};\n" },
  });
  expectFailure(
    "package-filesystem-unsupported",
    "unsafe-name-root",
    () =>
      measureInstalledPackageClosure(
        request(unsafeNameProject, "unsafe-name-root"),
      ),
    unsafeNameProject,
  );

  const withInheritedRequestValue = <T>(
    key: string,
    value: unknown,
    action: () => T,
  ): T => {
    assert.equal(Object.hasOwn(Object.prototype, key), false);
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true,
    });
    try {
      return action();
    } finally {
      assert.equal(Reflect.deleteProperty(Object.prototype, key), true);
    }
  };
  withInheritedRequestValue(
    "expectedPackageName",
    "inherited-wrong-package",
    () => {
      assert.equal(
        measureInstalledPackageClosure(request(hoisted, "fixture-root"))
          .packageCount,
        2,
      );
    },
  );
  const completeRequest = request(hoisted, "fixture-root");
  const requestWithoutProvider = {
    resolutionProfile: completeRequest.resolutionProfile,
    resolutionBaseUrl: completeRequest.resolutionBaseUrl,
    roots: completeRequest.roots,
    limits: completeRequest.limits,
  } as unknown as InstalledPackageClosureRequest;
  withInheritedRequestValue("providerKind", "genes.test.processor", () => {
    expectFailure("invalid-request", "providerKind", () =>
      measureInstalledPackageClosure(requestWithoutProvider),
    );
  });
  const limitsWithoutFiles = {
    maxPackages: LIMITS.maxPackages,
    maxEdges: LIMITS.maxEdges,
    maxEntries: LIMITS.maxEntries,
    maxBytes: LIMITS.maxBytes,
    maxPathBytes: LIMITS.maxPathBytes,
  } as unknown as InstalledPackageClosureLimits;
  withInheritedRequestValue("maxFiles", LIMITS.maxFiles, () => {
    expectFailure("invalid-request", "limits", () =>
      measureInstalledPackageClosure({
        ...completeRequest,
        limits: limitsWithoutFiles,
      }),
    );
  });
  const rootWithoutPackageName = {
    expectedVersion: "1.0.0",
  } as unknown as InstalledPackageRoot;
  withInheritedRequestValue("packageName", "fixture-root", () => {
    expectFailure("invalid-request", "roots", () =>
      measureInstalledPackageClosure({
        ...completeRequest,
        roots: [rootWithoutPackageName],
      }),
    );
  });

  const requestReads = new Map<string, number>();
  const readOnce = <T>(field: string, value: T): T => {
    requestReads.set(field, (requestReads.get(field) ?? 0) + 1);
    return value;
  };
  const accessorRoot: InstalledPackageRoot = {
    get packageName(): string {
      return readOnce("root.packageName", "fixture-root");
    },
    get expectedPackageName(): string | undefined {
      return readOnce("root.expectedPackageName", undefined);
    },
    get expectedVersion(): string {
      return readOnce("root.expectedVersion", "1.0.0");
    },
  };
  const accessorRoots = new Proxy([accessorRoot], {
    get(target, key, receiver): unknown {
      if (key === Symbol.iterator) throw new Error("iterator must not be read");
      if (key === "length") readOnce("roots.length", undefined);
      if (key === "0") readOnce("roots.0", undefined);
      return Reflect.get(target, key, receiver);
    },
  });
  const accessorLimits: InstalledPackageClosureLimits = {
    get maxPackages(): number {
      return readOnce("limits.maxPackages", LIMITS.maxPackages);
    },
    get maxEdges(): number {
      return readOnce("limits.maxEdges", LIMITS.maxEdges);
    },
    get maxEntries(): number {
      return readOnce("limits.maxEntries", LIMITS.maxEntries);
    },
    get maxFiles(): number {
      return readOnce("limits.maxFiles", LIMITS.maxFiles);
    },
    get maxBytes(): number {
      return readOnce("limits.maxBytes", LIMITS.maxBytes);
    },
    get maxPathBytes(): number {
      return readOnce("limits.maxPathBytes", LIMITS.maxPathBytes);
    },
  };
  const accessorRequest: InstalledPackageClosureRequest = {
    get providerKind(): string {
      return readOnce("request.providerKind", "genes.test.processor");
    },
    get resolutionProfile(): typeof INSTALLED_PACKAGE_RESOLUTION_PROFILE {
      return readOnce(
        "request.resolutionProfile",
        INSTALLED_PACKAGE_RESOLUTION_PROFILE,
      );
    },
    get resolutionBaseUrl(): string {
      return readOnce(
        "request.resolutionBaseUrl",
        pathToFileURL(path.join(hoisted, "anchor.mjs")).href,
      );
    },
    get roots(): readonly InstalledPackageRoot[] {
      return readOnce("request.roots", accessorRoots);
    },
    get limits(): InstalledPackageClosureLimits {
      return readOnce("request.limits", accessorLimits);
    },
  };
  measureInstalledPackageClosure(accessorRequest);
  for (const [field, count] of requestReads) {
    assert.equal(count, 1, `${field} is captured exactly once`);
  }
  assert.equal(requestReads.size, 16);

  const revokedRoots = Proxy.revocable<InstalledPackageRoot[]>([], {});
  revokedRoots.revoke();
  expectFailure("invalid-request", "roots", () => {
    measureInstalledPackageClosure({
      ...request(hoisted, "fixture-root"),
      roots: revokedRoots.proxy,
    });
  });

  const changingLimitProject = projectRoot("genes-package-changing-limit-");
  temporaryRoots.push(changingLimitProject);
  createPackage(packageRoot(changingLimitProject, "limit-root"), {
    name: "limit-root",
  });
  let maxFilesReads = 0;
  const changingLimits: InstalledPackageClosureLimits = {
    ...LIMITS,
    get maxFiles(): number {
      maxFilesReads += 1;
      return maxFilesReads === 1 ? 1 : LIMITS.maxFiles;
    },
  };
  expectFailure("package-closure-limit", "maxFiles", () => {
    measureInstalledPackageClosure(
      request(
        changingLimitProject,
        "limit-root",
        "genes.test.processor",
        changingLimits,
      ),
    );
  });
  assert.equal(maxFilesReads, 1);

  expectFailure(
    "invalid-request",
    "providerKind",
    () => {
      measureInstalledPackageClosure({
        get providerKind(): string {
          throw new Error("caller-private-message");
        },
        resolutionProfile: INSTALLED_PACKAGE_RESOLUTION_PROFILE,
        resolutionBaseUrl: pathToFileURL(path.join(hoisted, "anchor.mjs")).href,
        roots: [{ packageName: "fixture-root", expectedVersion: "1.0.0" }],
        limits: LIMITS,
      });
    },
    "caller-private-message",
  );

  const changingClosure = projectRoot("genes-package-changing-closure-");
  temporaryRoots.push(changingClosure);
  const earlyRoot = createPackage(packageRoot(changingClosure, "a-early"), {
    name: "a-early",
    files: { "value.txt": "before\n" },
  });
  const changedFile = path.join(earlyRoot, "value.txt");
  let providerKindReads = 0;
  const changingRequest: InstalledPackageClosureRequest = {
    get providerKind(): string {
      providerKindReads += 1;
      return "genes.test.processor";
    },
    resolutionProfile: INSTALLED_PACKAGE_RESOLUTION_PROFILE,
    resolutionBaseUrl: pathToFileURL(
      path.join(changingClosure, "anchor.mjs"),
    ).href,
    roots: [{ packageName: "a-early", expectedVersion: "1.0.0" }],
    limits: LIMITS,
  };
  expectFailure(
    "package-closure-changed",
    "genes.test.processor",
    () =>
      measureInstalledPackageClosureWithHooks(changingRequest, {
        afterFirstCapture: () => writeFileSync(changedFile, "after!\n", "utf8"),
      }),
    changingClosure,
  );
  assert.equal(providerKindReads, 1);

  const firstBase = projectRoot("genes-package-base-first-");
  const secondBase = projectRoot("genes-package-base-second-");
  const baseLinkOwner = projectRoot("genes-package-base-link-");
  temporaryRoots.push(firstBase, secondBase, baseLinkOwner);
  createPackage(packageRoot(firstBase, "base-root"), {
    name: "base-root",
    files: { "value.txt": "first\n" },
  });
  createPackage(packageRoot(secondBase, "base-root"), {
    name: "base-root",
    files: { "value.txt": "second\n" },
  });
  const linkedBase = path.join(baseLinkOwner, "active");
  symlinkSync(firstBase, linkedBase, "dir");
  let baseProviderKindReads = 0;
  const changingBaseRequest: InstalledPackageClosureRequest = {
    get providerKind(): string {
      baseProviderKindReads += 1;
      return "genes.test.processor";
    },
    resolutionProfile: INSTALLED_PACKAGE_RESOLUTION_PROFILE,
    resolutionBaseUrl: pathToFileURL(path.join(linkedBase, "anchor.mjs")).href,
    roots: [{ packageName: "base-root", expectedVersion: "1.0.0" }],
    limits: LIMITS,
  };
  expectFailure(
    "package-closure-changed",
    "genes.test.processor",
    () =>
      measureInstalledPackageClosureWithHooks(changingBaseRequest, {
        afterFirstCapture: () => {
          unlinkSync(linkedBase);
          symlinkSync(secondBase, linkedBase, "dir");
        },
      }),
    baseLinkOwner,
  );
  assert.equal(baseProviderKindReads, 1);

  const virtualRead = projectRoot("genes-package-virtual-read-");
  temporaryRoots.push(virtualRead);
  const virtualMetadata = `${JSON.stringify({
    name: "virtual-root",
    version: "1.0.0",
  })}\n`;
  createPackage(packageRoot(virtualRead, "virtual-root"), {
    name: "virtual-root",
    entry: null,
    packageJsonText: virtualMetadata,
    files: { "virtual.bin": "" },
  });
  const overflowRequests: number[] = [];
  expectFailure("package-closure-limit", "maxBytes", () => {
    measureInstalledPackageClosureWithHooks(
      request(virtualRead, "virtual-root", "genes.test.processor", {
        ...LIMITS,
        maxBytes: Buffer.byteLength(virtualMetadata),
      }),
      {
        readFileChunk: ({ requestedBytes, subject }) => {
          if (!subject.endsWith(":virtual.bin")) return undefined;
          overflowRequests.push(requestedBytes);
          return requestedBytes;
        },
      },
    );
  });
  assert.deepEqual(overflowRequests, [1]);

  let inconsistentReadCalls = 0;
  expectFailure(
    "package-filesystem-unsupported",
    "virtual-root:virtual.bin",
    () => {
      measureInstalledPackageClosureWithHooks(
        request(virtualRead, "virtual-root", "genes.test.processor", {
          ...LIMITS,
          maxBytes: Buffer.byteLength(virtualMetadata) + 8,
        }),
        {
          readFileChunk: ({ buffer, subject }) => {
            if (!subject.endsWith(":virtual.bin")) return undefined;
            inconsistentReadCalls += 1;
            if (inconsistentReadCalls > 1) return 0;
            buffer[0] = 0x61;
            return 1;
          },
        },
      );
    },
    virtualRead,
  );
  assert.equal(inconsistentReadCalls, 2);

  for (const [race, mutate] of [
    ["truncate", (file: string): void => writeFileSync(file, "", "utf8")],
    [
      "grow",
      (file: string): void => writeFileSync(file, "before-after\n", "utf8"),
    ],
    ["delete", (file: string): void => rmSync(file, { force: true })],
    [
      "replace",
      (file: string): void => {
        rmSync(file, { force: true });
        writeFileSync(file, "replacement\n", "utf8");
      },
    ],
  ] as const) {
    const raceProject = projectRoot(`genes-package-reader-${race}-`);
    temporaryRoots.push(raceProject);
    const raceRoot = createPackage(packageRoot(raceProject, "race-root"), {
      name: "race-root",
      files: { "race.txt": "before\n" },
    });
    const raceFile = path.join(raceRoot, "race.txt");
    let changed = false;
    expectFailure(
      "package-closure-changed",
      "race-root:race.txt",
      () =>
        measureInstalledPackageClosureWithHooks(
          request(raceProject, "race-root"),
          {
            afterFileRead: (subject) => {
              if (!changed && subject === "race-root:race.txt") {
                changed = true;
                mutate(raceFile);
              }
            },
          },
        ),
      raceProject,
    );
    assert.equal(changed, true);
  }

  const caseProbe = projectRoot("genes-package-case-probe-");
  temporaryRoots.push(caseProbe);
  const preservedNodeModules = path.join(caseProbe, "Node_Modules");
  mkdirSync(preservedNodeModules);
  let caseInsensitive = false;
  try {
    const preserved = lstatSync(preservedNodeModules, { bigint: true });
    const lowercase = lstatSync(path.join(caseProbe, "node_modules"), {
      bigint: true,
    });
    caseInsensitive =
      preserved.dev === lowercase.dev && preserved.ino === lowercase.ino;
  } catch {
    caseInsensitive = false;
  }

  if (caseInsensitive) {
    const createCaseAliasLayout = (
      project: string,
      resolverName: "node_modules" | "Node_Modules",
    ): {
      readonly root: string;
      readonly actual: string;
      readonly ignored: string;
      readonly decoy: string;
    } => {
      const resolverRoot = path.join(project, resolverName);
      const root = createPackage(path.join(resolverRoot, "case-root"), {
        name: "case-root",
        dependencies: { "case-dependency": "1.0.0" },
      });
      const actual = createPackage(path.join(resolverRoot, "case-dependency"), {
        name: "case-dependency",
      });
      const decoy = createPackage(
        path.join(resolverRoot, "node_modules", "case-dependency"),
        { name: "decoy-dependency" },
      );
      const nestedResolver = path.join(root, resolverName);
      mkdirSync(nestedResolver, { recursive: true });
      const ignored = path.join(nestedResolver, "ignored.txt");
      writeFileSync(ignored, "ignored-before\n", "utf8");
      return {
        root,
        actual: path.join(actual, "index.cjs"),
        ignored,
        decoy: path.join(decoy, "index.cjs"),
      };
    };
    const preservedProject = projectRoot("genes-package-case-preserved-");
    const lowercaseProject = projectRoot("genes-package-case-lowercase-");
    temporaryRoots.push(preservedProject, lowercaseProject);
    const preservedLayout = createCaseAliasLayout(
      preservedProject,
      "Node_Modules",
    );
    const lowercaseLayout = createCaseAliasLayout(
      lowercaseProject,
      "node_modules",
    );
    const preservedMeasurement = measureInstalledPackageClosure(
      request(preservedProject, "case-root"),
    );
    const lowercaseMeasurement = measureInstalledPackageClosure(
      request(lowercaseProject, "case-root"),
    );
    assert.notEqual(
      preservedMeasurement.installedClosureIntegrity,
      lowercaseMeasurement.installedClosureIntegrity,
    );
    assert.equal(
      realpathSync.native(
        createRequire(path.join(preservedLayout.root, "consumer.cjs")).resolve(
          "case-dependency",
        ),
      ),
      realpathSync.native(preservedLayout.decoy),
    );
    assert.equal(
      realpathSync.native(
        createRequire(path.join(lowercaseLayout.root, "consumer.cjs")).resolve(
          "case-dependency",
        ),
      ),
      realpathSync.native(lowercaseLayout.actual),
    );
    writeFileSync(preservedLayout.ignored, "ignored-after\n", "utf8");
    assert.deepEqual(
      measureInstalledPackageClosure(request(preservedProject, "case-root")),
      preservedMeasurement,
    );
    writeFileSync(preservedLayout.decoy, "decoy-after\n", "utf8");
    assert.notEqual(
      measureInstalledPackageClosure(request(preservedProject, "case-root"))
        .installedClosureIntegrity,
      preservedMeasurement.installedClosureIntegrity,
    );
  } else {
    const sensitiveProject = projectRoot("genes-package-case-sensitive-");
    temporaryRoots.push(sensitiveProject);
    const sensitiveRoot = createPackage(
      packageRoot(sensitiveProject, "case-root"),
      { name: "case-root" },
    );
    const ordinaryUppercase = path.join(sensitiveRoot, "Node_Modules");
    const skippedLowercase = path.join(sensitiveRoot, "node_modules");
    write(path.join(ordinaryUppercase, "owned.txt"), "owned-before\n");
    write(path.join(skippedLowercase, "ignored.txt"), "ignored-before\n");
    const before = measureInstalledPackageClosure(
      request(sensitiveProject, "case-root"),
    );
    write(path.join(skippedLowercase, "ignored.txt"), "ignored-after\n");
    assert.deepEqual(
      measureInstalledPackageClosure(request(sensitiveProject, "case-root")),
      before,
    );
    write(path.join(ordinaryUppercase, "owned.txt"), "owned-after\n");
    assert.notEqual(
      measureInstalledPackageClosure(request(sensitiveProject, "case-root"))
        .installedClosureIntegrity,
      before.installedClosureIntegrity,
    );
  }
  console.log(
    `installed-package-closure:filesystem-case=${
      caseInsensitive ? "insensitive" : "sensitive"
    }`,
  );

  process.env.NODE_PATH = path.join(hoisted, "node_modules");
  try {
    expectFailure(
      "resolution-profile-unsupported",
      INSTALLED_PACKAGE_RESOLUTION_PROFILE,
      () =>
        measureInstalledPackageClosure(request(hoisted, "fixture-root")),
    );
  } finally {
    delete process.env.NODE_PATH;
  }
  process.env.NODE_PATH = " ";
  try {
    expectFailure(
      "resolution-profile-unsupported",
      INSTALLED_PACKAGE_RESOLUTION_PROFILE,
      () =>
        measureInstalledPackageClosure(request(hoisted, "fixture-root")),
    );
  } finally {
    delete process.env.NODE_PATH;
  }
  process.env.NODE_PRESERVE_SYMLINKS = "1";
  try {
    expectFailure(
      "resolution-profile-unsupported",
      INSTALLED_PACKAGE_RESOLUTION_PROFILE,
      () =>
        measureInstalledPackageClosure(request(hoisted, "fixture-root")),
    );
  } finally {
    delete process.env.NODE_PRESERVE_SYMLINKS;
  }
  process.env.NODE_PRESERVE_SYMLINKS_MAIN = "1";
  try {
    expectFailure(
      "resolution-profile-unsupported",
      INSTALLED_PACKAGE_RESOLUTION_PROFILE,
      () =>
        measureInstalledPackageClosure(request(hoisted, "fixture-root")),
    );
  } finally {
    delete process.env.NODE_PRESERVE_SYMLINKS_MAIN;
  }
  process.env.NODE_OPTIONS = "--trace-warnings";
  try {
    expectFailure(
      "resolution-profile-unsupported",
      INSTALLED_PACKAGE_RESOLUTION_PROFILE,
      () =>
        measureInstalledPackageClosure(request(hoisted, "fixture-root")),
    );
  } finally {
    delete process.env.NODE_OPTIONS;
  }
  process.execArgv.push("--preserve-symlinks");
  try {
    expectFailure(
      "resolution-profile-unsupported",
      INSTALLED_PACKAGE_RESOLUTION_PROFILE,
      () =>
        measureInstalledPackageClosure(request(hoisted, "fixture-root")),
    );
  } finally {
    assert.equal(process.execArgv.pop(), "--preserve-symlinks");
  }
  process.execArgv.push("--preserve_symlinks");
  try {
    expectFailure(
      "resolution-profile-unsupported",
      INSTALLED_PACKAGE_RESOLUTION_PROFILE,
      () =>
        measureInstalledPackageClosure(request(hoisted, "fixture-root")),
    );
  } finally {
    assert.equal(process.execArgv.pop(), "--preserve_symlinks");
  }
  process.execArgv.push("--experimental_loader=data:text/javascript,");
  try {
    expectFailure(
      "resolution-profile-unsupported",
      INSTALLED_PACKAGE_RESOLUTION_PROFILE,
      () =>
        measureInstalledPackageClosure(request(hoisted, "fixture-root")),
    );
  } finally {
    assert.equal(
      process.execArgv.pop(),
      "--experimental_loader=data:text/javascript,",
    );
  }

  const typeScriptRequest: InstalledPackageClosureRequest = {
    providerKind: "genes.test.typescript",
    resolutionProfile: INSTALLED_PACKAGE_RESOLUTION_PROFILE,
    resolutionBaseUrl: import.meta.url,
    roots: [{
      packageName: "typescript",
      expectedPackageName: "@typescript/typescript6",
      expectedVersion: "6.0.2",
    }],
    limits: {
      maxPackages: 8,
      maxEdges: 16,
      maxEntries: 512,
      maxFiles: 512,
      maxBytes: 64 * 1024 * 1024,
      maxPathBytes: 512,
    },
  };
  const firstHashStartedAt = performance.now();
  const actualTypeScript = measureInstalledPackageClosure(typeScriptRequest);
  const firstHashDurationMs = performance.now() - firstHashStartedAt;
  const secondHashStartedAt = performance.now();
  const repeatedTypeScript = measureInstalledPackageClosure(typeScriptRequest);
  const secondHashDurationMs = performance.now() - secondHashStartedAt;
  assert.deepEqual(repeatedTypeScript, actualTypeScript);
  assert.equal(actualTypeScript.packageCount, 2);
  assert.equal(actualTypeScript.edgeCount, 1);
  assert(actualTypeScript.fileCount > 100);
  assert(actualTypeScript.totalBytes > 10 * 1024 * 1024);
  console.log(
    `installed-package-closure:metrics packages=${actualTypeScript.packageCount} ` +
      `edges=${actualTypeScript.edgeCount} entries=${actualTypeScript.entryCount} ` +
      `files=${actualTypeScript.fileCount} bytes=${actualTypeScript.totalBytes} ` +
      `firstHashMs=${firstHashDurationMs.toFixed(2)} ` +
      `secondHashMs=${secondHashDurationMs.toFixed(2)}`,
  );
  console.log("installed-package-closure:ok");
} finally {
  for (const root of temporaryRoots.reverse()) {
    rmSync(root, { recursive: true, force: true });
  }
}
