import assert from "node:assert/strict";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import {
  InstalledProcessorClosureError,
  measureInstalledProcessorClosure,
  type InstalledProcessorClosureLimits,
  type InstalledProcessorClosureMeasurement,
  type InstalledProcessorClosureRequest,
} from "./css-modules/installed-processor-closure.js";

const LIMITS: InstalledProcessorClosureLimits = Object.freeze({
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
  readonly entry?: string;
  readonly files?: Readonly<Record<string, string>>;
}

function write(absolute: string, bytes: string): void {
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, bytes, "utf8");
}

function createPackage(root: string, options: PackageOptions): string {
  const entry = options.entry ?? "index.cjs";
  const metadata = {
    name: options.name,
    version: options.version ?? "1.0.0",
    main: entry,
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
  };
  write(path.join(root, "package.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  write(
    path.join(root, entry),
    options.files?.[entry] ?? `module.exports = ${JSON.stringify(options.name)};\n`,
  );
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
  limits: InstalledProcessorClosureLimits = LIMITS,
): InstalledProcessorClosureRequest {
  return Object.freeze({
    providerKind,
    resolutionBaseUrl: pathToFileURL(path.join(project, "anchor.mjs")).href,
    roots: Object.freeze([
      Object.freeze({ packageName, expectedVersion: "1.0.0" }),
    ]),
    limits,
  });
}

function expectFailure(
  code: InstalledProcessorClosureError["code"],
  subject: string,
  action: () => unknown,
): void {
  assert.throws(action, (error: unknown) => {
    return (
      error instanceof InstalledProcessorClosureError &&
      error.code === code &&
      error.subject === subject
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

function assertSameCounts(
  left: InstalledProcessorClosureMeasurement,
  right: InstalledProcessorClosureMeasurement,
): void {
  assert.deepEqual(
    {
      packages: left.packageCount,
      edges: left.edgeCount,
      entries: left.entryCount,
      files: left.fileCount,
      bytes: left.totalBytes,
    },
    {
      packages: right.packageCount,
      edges: right.edgeCount,
      entries: right.entryCount,
      files: right.fileCount,
      bytes: right.totalBytes,
    },
  );
}

async function workerMessage(
  workerData: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const worker = new Worker(
    new URL("./installed-processor-closure-test-worker.js", import.meta.url),
    { workerData },
  );
  const messagePromise = once(worker, "message");
  const exitPromise = once(worker, "exit");
  const [message] = await messagePromise;
  const [exitCode] = await exitPromise;
  assert.equal(exitCode, 0, "the measured processor worker exits once");
  return message;
}

const temporaryRoots: string[] = [];
try {
  const hoisted = projectRoot("genes-processor-hoisted-");
  const nested = projectRoot("genes-processor-nested-");
  temporaryRoots.push(hoisted, nested);
  graphFixture(hoisted, false);
  graphFixture(nested, true);
  const hoistedMeasurement = measureInstalledProcessorClosure(
    request(hoisted, "fixture-root"),
  );
  const nestedMeasurement = measureInstalledProcessorClosure(
    request(nested, "fixture-root"),
  );
  assert.match(hoistedMeasurement.integrity, /^sha256-[A-Za-z0-9+/]{43}=$/u);
  assert.equal(
    hoistedMeasurement.integrity,
    nestedMeasurement.integrity,
    "equivalent resolution graphs ignore physical hoisting",
  );
  assertSameCounts(hoistedMeasurement, nestedMeasurement);
  assert.equal(hoistedMeasurement.packageCount, 2);
  assert.equal(hoistedMeasurement.edgeCount, 1);
  const multipleRoots = [
    { packageName: "fixture-root", expectedVersion: "1.0.0" },
    { packageName: "fixture-dependency", expectedVersion: "1.0.0" },
  ] as const;
  const multipleRootRequest = request(hoisted, "fixture-root");
  const forwardRoots = measureInstalledProcessorClosure({
    ...multipleRootRequest,
    roots: multipleRoots,
  });
  const reverseRoots = measureInstalledProcessorClosure({
    ...multipleRootRequest,
    roots: [...multipleRoots].reverse(),
  });
  assert.equal(
    forwardRoots.integrity,
    reverseRoots.integrity,
    "fixed root order does not change the canonical identity",
  );
  assert.equal(forwardRoots.packageCount, 2);

  const byteChanged = projectRoot("genes-processor-byte-");
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
    measureInstalledProcessorClosure(request(byteChanged, "fixture-root"))
      .integrity,
    hoistedMeasurement.integrity,
    "one package-owned byte change changes the identity",
  );

  const edgeChanged = projectRoot("genes-processor-edge-");
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
    measureInstalledProcessorClosure(request(edgeChanged, "fixture-root"))
      .integrity,
    hoistedMeasurement.integrity,
    "a different resolved dependency instance changes the identity",
  );

  const optionalAbsent = projectRoot("genes-processor-optional-absent-");
  const optionalPresent = projectRoot("genes-processor-optional-present-");
  temporaryRoots.push(optionalAbsent, optionalPresent);
  for (const project of [optionalAbsent, optionalPresent]) {
    createPackage(packageRoot(project, "optional-root"), {
      name: "optional-root",
      optionalDependencies: { "optional-runtime": "1.0.0" },
    });
  }
  createPackage(packageRoot(optionalPresent, "optional-runtime"), {
    name: "optional-runtime",
  });
  const absentMeasurement = measureInstalledProcessorClosure(
    request(optionalAbsent, "optional-root"),
  );
  const presentMeasurement = measureInstalledProcessorClosure(
    request(optionalPresent, "optional-root"),
  );
  assert.equal(absentMeasurement.packageCount, 1);
  assert.equal(absentMeasurement.edgeCount, 1);
  assert.equal(presentMeasurement.packageCount, 2);
  assert.notEqual(absentMeasurement.integrity, presentMeasurement.integrity);

  const peerAbsent = projectRoot("genes-processor-peer-absent-");
  const peerPresent = projectRoot("genes-processor-peer-present-");
  temporaryRoots.push(peerAbsent, peerPresent);
  for (const project of [peerAbsent, peerPresent]) {
    createPackage(packageRoot(project, "peer-root"), {
      name: "peer-root",
      peerDependencies: { "peer-runtime": "1.0.0" },
      peerDependenciesMeta: { "peer-runtime": { optional: true } },
    });
  }
  createPackage(packageRoot(peerPresent, "peer-runtime"), {
    name: "peer-runtime",
  });
  const peerAbsentMeasurement = measureInstalledProcessorClosure(
    request(peerAbsent, "peer-root"),
  );
  const peerPresentMeasurement = measureInstalledProcessorClosure(
    request(peerPresent, "peer-root"),
  );
  assert.equal(peerAbsentMeasurement.packageCount, 1);
  assert.equal(peerAbsentMeasurement.edgeCount, 1);
  assert.equal(peerPresentMeasurement.packageCount, 2);
  assert.notEqual(
    peerAbsentMeasurement.integrity,
    peerPresentMeasurement.integrity,
  );

  const mandatoryPeer = projectRoot("genes-processor-peer-mandatory-");
  temporaryRoots.push(mandatoryPeer);
  createPackage(packageRoot(mandatoryPeer, "peer-root"), {
    name: "peer-root",
    peerDependencies: { "peer-runtime": "1.0.0" },
  });
  expectFailure(
    "package-unavailable",
    "peer-root:peer-runtime",
    () => measureInstalledProcessorClosure(request(mandatoryPeer, "peer-root")),
  );

  const linkedProject = projectRoot("genes-processor-root-link-");
  const directProject = projectRoot("genes-processor-root-direct-");
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
    measureInstalledProcessorClosure(request(linkedProject, "linked-root"))
      .integrity,
    measureInstalledProcessorClosure(request(directProject, "linked-root"))
      .integrity,
    "a package-root indirection does not enter the identity",
  );

  const internalLink = projectRoot("genes-processor-internal-link-");
  temporaryRoots.push(internalLink);
  const internalRoot = createPackage(packageRoot(internalLink, "internal-link"), {
    name: "internal-link",
  });
  symlinkSync("index.cjs", path.join(internalRoot, "linked.cjs"));
  expectFailure(
    "package-symlink-unsupported",
    "internal-link:linked.cjs",
    () => measureInstalledProcessorClosure(request(internalLink, "internal-link")),
  );

  const aliasProject = projectRoot("genes-processor-alias-");
  temporaryRoots.push(aliasProject);
  createPackage(packageRoot(aliasProject, "alias-root"), {
    name: "alias-root",
    dependencies: { alias: "npm:actual-runtime@1.0.0" },
  });
  createPackage(packageRoot(aliasProject, "alias"), {
    name: "actual-runtime",
  });
  assert.equal(
    measureInstalledProcessorClosure(request(aliasProject, "alias-root"))
      .packageCount,
    2,
    "an alias edge records the resolved package identity",
  );

  const cycleProject = projectRoot("genes-processor-cycle-");
  temporaryRoots.push(cycleProject);
  const cycleRoot = createPackage(packageRoot(cycleProject, "cycle-root"), {
    name: "cycle-root",
    dependencies: { "cycle-child": "1.0.0" },
  });
  createPackage(path.join(cycleRoot, "node_modules", "cycle-child"), {
    name: "cycle-child",
    dependencies: { "cycle-root": "1.0.0" },
  });
  const cycleMeasurement = measureInstalledProcessorClosure(
    request(cycleProject, "cycle-root"),
  );
  assert.equal(cycleMeasurement.packageCount, 2);
  assert.equal(cycleMeasurement.edgeCount, 2);

  const duplicateProject = projectRoot("genes-processor-duplicate-");
  temporaryRoots.push(duplicateProject);
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
      version: side === "left" ? "1.0.0" : "2.0.0",
    });
  }
  assert.equal(
    measureInstalledProcessorClosure(request(duplicateProject, "duplicate-root"))
      .packageCount,
    5,
    "different resolved package instances remain distinct graph nodes",
  );

  expectFailure(
    "package-closure-limit",
    "maxPackages",
    () =>
      measureInstalledProcessorClosure(
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
      measureInstalledProcessorClosure(
        request(project, rootName, "genes.test.processor", {
          ...LIMITS,
          [limit]: value,
        }),
      );
    });
  }
  expectFailure(
    "package-version-mismatch",
    "fixture-root",
    () =>
      measureInstalledProcessorClosure({
        ...request(hoisted, "fixture-root"),
        roots: [{ packageName: "fixture-root", expectedVersion: "9.9.9" }],
      }),
  );
  assert.notEqual(
    measureInstalledProcessorClosure(
      request(hoisted, "fixture-root", "genes.test.other-processor"),
    ).integrity,
    hoistedMeasurement.integrity,
    "the provider kind domain-separates equal package closures",
  );

  const workerProject = projectRoot("genes-processor-worker-");
  temporaryRoots.push(workerProject);
  const workerPackage = createPackage(packageRoot(workerProject, "worker-root"), {
    name: "worker-root",
    files: {
      "index.cjs": [
        'globalThis[Symbol.for("genes.test.processor-loaded")] = true;',
        'module.exports = { value: "worker-result" };',
        "",
      ].join("\n"),
    },
  });
  const workerStartedAt = performance.now();
  const stableMessage = await workerMessage({
    request: request(workerProject, "worker-root"),
    packageName: "worker-root",
  });
  const workerDurationMs = performance.now() - workerStartedAt;
  assert.deepEqual(stableMessage, {
    ok: true,
    result: "worker-result",
    loadedBeforeOperation: false,
    processorIntegrity: measureInstalledProcessorClosure(
      request(workerProject, "worker-root"),
    ).integrity,
  });

  const changedMessage = await workerMessage({
    request: request(workerProject, "worker-root"),
    packageName: "worker-root",
    mutatePath: path.join(workerPackage, "index.cjs"),
  });
  assert.deepEqual(changedMessage, {
    ok: false,
    code: "package-closure-changed",
    subject: "genes.test.processor",
  });

  const typeScriptRequest: InstalledProcessorClosureRequest = {
    providerKind: "genes.test.typescript",
    resolutionBaseUrl: import.meta.url,
    roots: [{
      packageName: "typescript",
      resolvedPackageName: "@typescript/typescript6",
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
  const actualTypeScript = measureInstalledProcessorClosure(typeScriptRequest);
  const firstHashDurationMs = performance.now() - firstHashStartedAt;
  const secondHashStartedAt = performance.now();
  const repeatedTypeScript = measureInstalledProcessorClosure(typeScriptRequest);
  const secondHashDurationMs = performance.now() - secondHashStartedAt;
  assert.deepEqual(repeatedTypeScript, actualTypeScript);
  assert.equal(actualTypeScript.packageCount, 2);
  assert.equal(actualTypeScript.edgeCount, 1);
  assert(actualTypeScript.fileCount > 100);
  assert(actualTypeScript.totalBytes > 10 * 1024 * 1024);
  console.log(
    `installed-processor-closure:metrics packages=${actualTypeScript.packageCount} ` +
      `edges=${actualTypeScript.edgeCount} entries=${actualTypeScript.entryCount} ` +
      `files=${actualTypeScript.fileCount} bytes=${actualTypeScript.totalBytes} ` +
      `firstHashMs=${firstHashDurationMs.toFixed(2)} ` +
      `secondHashMs=${secondHashDurationMs.toFixed(2)} ` +
      `workerMs=${workerDurationMs.toFixed(2)}`,
  );
  console.log("installed-processor-closure:ok");
} finally {
  for (const root of temporaryRoots.reverse()) {
    rmSync(root, { recursive: true, force: true });
  }
}
