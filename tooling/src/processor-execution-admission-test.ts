import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  INSTALLED_PACKAGE_RESOLUTION_PROFILE,
  InstalledPackageClosureError,
  measureInstalledPackageClosure,
  type InstalledPackageClosureLimits,
  type InstalledPackageClosureRequest,
  type InstalledPackageRoot,
} from "./css-modules/installed-package-closure.js";
import {
  executeAdmittedProcessor,
  executeAdmittedProcessorWithHooks,
  ProcessorExecutionAdmissionError,
  type AdmittedProcessorExecutionRequest,
  type ProcessorExecutionData,
  type ProcessorExecutionLimits,
} from "./css-modules/processor-execution-admission.js";

const CLOSURE_LIMITS: InstalledPackageClosureLimits = Object.freeze({
  maxPackages: 32,
  maxEdges: 64,
  maxEntries: 512,
  maxFiles: 256,
  maxBytes: 4 * 1024 * 1024,
  maxPathBytes: 512,
});
const EXECUTION_LIMITS: ProcessorExecutionLimits = Object.freeze({
  maxRequestBytes: 64 * 1024,
  maxResultBytes: 64 * 1024,
  // Background CI and developer hosts can heavily deprioritize a fresh child.
  // The dedicated timeout fixture below keeps the fail-closed behavior exact.
  timeoutMs: 30_000,
});

interface PackageOptions {
  readonly name: string;
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly entry?: string;
  readonly files?: Readonly<Record<string, string>>;
}

function write(absolute: string, content: string): void {
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function createPackage(root: string, options: PackageOptions): string {
  const entry = options.entry ?? "index.cjs";
  write(
    path.join(root, "package.json"),
    `${JSON.stringify({
      name: options.name,
      version: options.version ?? "1.0.0",
      main: entry,
      ...(options.dependencies === undefined
        ? {}
        : { dependencies: options.dependencies }),
      ...(options.optionalDependencies === undefined
        ? {}
        : { optionalDependencies: options.optionalDependencies }),
    })}\n`,
  );
  write(
    path.join(root, entry),
    options.files?.[entry] ??
      `exports.runGenesProcessor = async (input) => input;\n`,
  );
  for (const [relative, content] of Object.entries(options.files ?? {})) {
    if (relative !== entry) write(path.join(root, relative), content);
  }
  return root;
}

function packageRoot(project: string, packageName: string): string {
  return path.join(project, "node_modules", ...packageName.split("/"));
}

function createProject(prefix: string): string {
  const project = realpathSync.native(
    mkdtempSync(path.join(realpathSync.native(tmpdir()), prefix)),
  );
  write(path.join(project, "anchor.mjs"), "export {};\n");
  temporaryRoots.push(project);
  return project;
}

function closureRequest(
  project: string,
  roots: readonly InstalledPackageRoot[],
  limits: InstalledPackageClosureLimits = CLOSURE_LIMITS,
  providerKind = "genes.test.execution-admission",
): InstalledPackageClosureRequest {
  return Object.freeze({
    providerKind,
    resolutionProfile: INSTALLED_PACKAGE_RESOLUTION_PROFILE,
    resolutionBaseUrl: pathToFileURL(path.join(project, "anchor.mjs")).href,
    roots: Object.freeze(roots.map((root) => Object.freeze({ ...root }))),
    limits,
  });
}

function executionRequest(
  closure: InstalledPackageClosureRequest,
  adapterPackageName: string,
  input: ProcessorExecutionData,
  limits: ProcessorExecutionLimits = EXECUTION_LIMITS,
): AdmittedProcessorExecutionRequest {
  return Object.freeze({
    closure,
    adapterPackageName,
    input,
    limits,
  });
}

async function expectExecutionFailure(
  code: ProcessorExecutionAdmissionError["code"],
  action: () => Promise<unknown>,
  forbiddenPath?: string,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    return (
      error instanceof ProcessorExecutionAdmissionError &&
      error.code === code &&
      (forbiddenPath === undefined || !error.message.includes(forbiddenPath))
    );
  });
}

async function expectClosureFailure(
  code: InstalledPackageClosureError["code"],
  action: () => Promise<unknown>,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    return error instanceof InstalledPackageClosureError && error.code === code;
  });
}

function linkPackage(target: string, link: string): void {
  mkdirSync(path.dirname(link), { recursive: true });
  symlinkSync(
    target,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
}

const temporaryRoots: string[] = [];
try {
  assert.equal(process.env.NODE_OPTIONS ?? "", "");
  assert.equal(process.env.NODE_PATH ?? "", "");

  const basic = createProject("genes-execution-basic-");
  createPackage(packageRoot(basic, "fixture-adapter"), {
    name: "fixture-adapter",
    files: {
      "index.cjs":
        "globalThis[Symbol.for('genes.test.adapter-loaded')] = true;\n" +
        "exports.runGenesProcessor = async (input) => ({ observed: input.value });\n",
    },
  });
  const basicClosure = closureRequest(basic, [
    { packageName: "fixture-adapter", expectedVersion: "1.0.0" },
  ]);
  const basicRequest = executionRequest(
    basicClosure,
    "fixture-adapter",
    Object.freeze({ value: "MEASURED" }),
  );
  const loadedMarker = Symbol.for("genes.test.adapter-loaded");
  assert.equal(Object.hasOwn(globalThis, loadedMarker), false);
  let basicMaterializedAt: number | undefined;
  let basicChildAt: number | undefined;
  let basicCleanedAt: number | undefined;
  const basicStartedAt = performance.now();
  const basicResult = await executeAdmittedProcessorWithHooks(basicRequest, {
    afterMaterialization: () => {
      basicMaterializedAt = performance.now();
    },
    afterChild: () => {
      basicChildAt = performance.now();
    },
    afterCleanup: () => {
      basicCleanedAt = performance.now();
    },
  });
  const basicDurationMs = performance.now() - basicStartedAt;
  assert(basicMaterializedAt !== undefined);
  assert(basicChildAt !== undefined);
  assert(basicCleanedAt !== undefined);
  const basicMaterializationMs = basicMaterializedAt - basicStartedAt;
  const basicChildMs = basicChildAt - basicMaterializedAt;
  const basicCleanupMs = basicCleanedAt - basicChildAt;
  assert.deepEqual(basicResult.result, { observed: "MEASURED" });
  assert.match(basicResult.processorIntegrity, /^sha256-[A-Za-z0-9+/]{43}=$/u);
  assert.equal(basicResult.packageCount, 1);
  assert.equal(basicResult.linkCount, 1);
  assert.equal(Object.hasOwn(globalThis, loadedMarker), false);

  const formats = createProject("genes-execution-formats-");
  createPackage(packageRoot(formats, "formats-adapter"), {
    name: "formats-adapter",
    entry: "index.mjs",
    files: {
      "index.mjs":
        "import { createRequire } from 'node:module';\n" +
        "import { fileURLToPath } from 'node:url';\n" +
        "import { esm } from './relative.mjs';\n" +
        "import data from './data.json' with { type: 'json' };\n" +
        "const require = createRequire(import.meta.url);\n" +
        "export async function runGenesProcessor() {\n" +
        "  const cjs = require('./value.cjs');\n" +
        "  const absolute = require(fileURLToPath(new URL('./absolute.cjs', import.meta.url)));\n" +
        "  const file = await import(new URL('./file.mjs', import.meta.url).href);\n" +
        "  return { absolute, cjs, esm, file: file.value, json: data.value };\n" +
        "}\n",
      "relative.mjs": "export const esm = 'ESM';\n",
      "data.json": '{"value":"JSON"}\n',
      "value.cjs": "module.exports = 'CJS';\n",
      "absolute.cjs": "module.exports = 'ABSOLUTE';\n",
      "file.mjs": "export const value = 'FILE';\n",
    },
  });
  const formatsResult = await executeAdmittedProcessor(
    executionRequest(
      closureRequest(formats, [
        { packageName: "formats-adapter", expectedVersion: "1.0.0" },
      ]),
      "formats-adapter",
      null,
    ),
  );
  assert.deepEqual(formatsResult.result, {
    absolute: "ABSOLUTE",
    cjs: "CJS",
    esm: "ESM",
    file: "FILE",
    json: "JSON",
  });

  let unsupportedMaterialized = false;
  const unreadableClosure = new Proxy(basicClosure, {
    get(): never {
      throw new Error("unsupported runtimes must not inspect the closure");
    },
  });
  await expectExecutionFailure(
    "execution-runtime-unsupported",
    () =>
      executeAdmittedProcessorWithHooks(
        executionRequest(unreadableClosure, "fixture-adapter", null),
        {
          nodeVersion: "20.9.0",
          afterMaterialization: () => {
            unsupportedMaterialized = true;
          },
        },
      ),
  );
  assert.equal(
    unsupportedMaterialized,
    false,
    "an unsupported runtime fails before source capture or publication",
  );

  const accessorInput = {
    get value(): string {
      return "must-not-run";
    },
  };
  await expectExecutionFailure(
    "invalid-execution-request",
    () =>
      executeAdmittedProcessor(
        executionRequest(basicClosure, "fixture-adapter", accessorInput),
      ),
  );
  const symbolicArray: ProcessorExecutionData[] = [];
  Object.defineProperty(symbolicArray, Symbol("ignored"), { value: "hidden" });
  await expectExecutionFailure(
    "invalid-execution-request",
    () =>
      executeAdmittedProcessor(
        executionRequest(basicClosure, "fixture-adapter", symbolicArray),
      ),
  );

  const optional = createProject("genes-execution-optional-");
  createPackage(packageRoot(optional, "optional-adapter"), {
    name: "optional-adapter",
    optionalDependencies: { "optional-runtime": "1.0.0" },
    files: {
      "index.cjs":
        "exports.runGenesProcessor = async () => " +
        "require('optional-runtime/subpath.cjs');\n",
    },
  });
  const optionalClosure = closureRequest(optional, [
    { packageName: "optional-adapter", expectedVersion: "1.0.0" },
  ]);
  const optionalAbsentIntegrity = measureInstalledPackageClosure(
    optionalClosure,
  ).installedClosureIntegrity;
  await expectExecutionFailure(
    "execution-module-unadmitted",
    () =>
      executeAdmittedProcessor(
        executionRequest(optionalClosure, "optional-adapter", null),
      ),
  );
  createPackage(packageRoot(optional, "optional-runtime"), {
    name: "optional-runtime",
    files: {
      "subpath.cjs": "module.exports = { value: 'PRESENT' };\n",
    },
  });
  const optionalPresentIntegrity = measureInstalledPackageClosure(
    optionalClosure,
  ).installedClosureIntegrity;
  assert.notEqual(optionalPresentIntegrity, optionalAbsentIntegrity);
  const optionalPresent = await executeAdmittedProcessor(
    executionRequest(optionalClosure, "optional-adapter", null),
  );
  assert.deepEqual(optionalPresent.result, { value: "PRESENT" });
  assert.equal(optionalPresent.processorIntegrity, optionalPresentIntegrity);

  const undeclared = createProject("genes-execution-undeclared-");
  createPackage(packageRoot(undeclared, "undeclared-adapter"), {
    name: "undeclared-adapter",
    files: {
      "index.cjs":
        "exports.runGenesProcessor = async () => " +
        "require('phantom/subpath.cjs');\n",
    },
  });
  createPackage(packageRoot(undeclared, "phantom"), {
    name: "phantom",
    files: {
      "subpath.cjs": "module.exports = { value: 'A' };\n",
    },
  });
  const undeclaredClosure = closureRequest(undeclared, [
    { packageName: "undeclared-adapter", expectedVersion: "1.0.0" },
  ]);
  const undeclaredA = measureInstalledPackageClosure(
    undeclaredClosure,
  ).installedClosureIntegrity;
  await expectExecutionFailure(
    "execution-module-unadmitted",
    () =>
      executeAdmittedProcessor(
        executionRequest(undeclaredClosure, "undeclared-adapter", null),
      ),
  );
  write(
    path.join(packageRoot(undeclared, "phantom"), "subpath.cjs"),
    "module.exports = { value: 'B' };\n",
  );
  const undeclaredB = measureInstalledPackageClosure(
    undeclaredClosure,
  ).installedClosureIntegrity;
  assert.equal(
    undeclaredB,
    undeclaredA,
    "undeclared package bytes do not enter declared closure evidence",
  );
  await expectExecutionFailure(
    "execution-module-unadmitted",
    () =>
      executeAdmittedProcessor(
        executionRequest(undeclaredClosure, "undeclared-adapter", null),
      ),
  );

  const transient = createProject("genes-execution-transient-");
  createPackage(packageRoot(transient, "transient-adapter"), {
    name: "transient-adapter",
    files: {
      "index.cjs":
        "exports.runGenesProcessor = async () => " +
        "({ value: require('./value.cjs') });\n",
      "value.cjs": "module.exports = 'A';\n",
    },
  });
  const transientClosure = closureRequest(transient, [
    { packageName: "transient-adapter", expectedVersion: "1.0.0" },
  ]);
  const transientRequest = executionRequest(
    transientClosure,
    "transient-adapter",
    null,
  );
  let copiedRoot: string | undefined;
  const transientResult = await executeAdmittedProcessorWithHooks(
    transientRequest,
    {
      afterMaterialization: (root) => {
        copiedRoot = root;
        assert.equal(existsSync(root), true);
        write(
          path.join(packageRoot(transient, "transient-adapter"), "value.cjs"),
          "module.exports = 'B';\n",
        );
      },
    },
  );
  assert.deepEqual(transientResult.result, { value: "A" });
  assert.notEqual(copiedRoot, undefined);
  assert.equal(existsSync(copiedRoot!), false, "private execution copy is removed");

  write(
    path.join(packageRoot(transient, "transient-adapter"), "value.cjs"),
    "module.exports = 'A';\n",
  );
  await expectClosureFailure(
    "package-closure-changed",
    () =>
      executeAdmittedProcessorWithHooks(transientRequest, {
        closure: {
          afterFirstCapture: () => {
            write(
              path.join(
                packageRoot(transient, "transient-adapter"),
                "value.cjs",
              ),
              "module.exports = 'B';\n",
            );
          },
        },
      }),
  );

  const selectionProject = createProject("genes-execution-selection-project-");
  const selectionStore = createProject("genes-execution-selection-store-");
  const storedAdapter = createPackage(
    path.join(selectionStore, "adapter"),
    {
      name: "selection-adapter",
      dependencies: { selection: "1.0.0" },
      files: {
        "index.cjs":
          "exports.runGenesProcessor = async () => require('selection');\n",
      },
    },
  );
  createPackage(packageRoot(selectionStore, "selection"), {
    name: "selection",
    files: { "index.cjs": "module.exports = { value: 'STORE' };\n" },
  });
  createPackage(packageRoot(selectionProject, "selection"), {
    name: "selection",
    files: { "index.cjs": "module.exports = { value: 'PROJECT' };\n" },
  });
  linkPackage(
    storedAdapter,
    packageRoot(selectionProject, "selection-adapter"),
  );
  const selectionClosure = closureRequest(selectionProject, [
    { packageName: "selection-adapter", expectedVersion: "1.0.0" },
  ]);
  const selection = await executeAdmittedProcessor(
    executionRequest(selectionClosure, "selection-adapter", null),
  );
  assert.deepEqual(selection.result, { value: "STORE" });
  process.execArgv.push("--preserve-symlinks");
  try {
    await expectClosureFailure(
      "resolution-profile-unsupported",
      () =>
        executeAdmittedProcessor(
          executionRequest(selectionClosure, "selection-adapter", null),
        ),
    );
  } finally {
    assert.equal(process.execArgv.pop(), "--preserve-symlinks");
  }

  const graph = createProject("genes-execution-graph-");
  createPackage(packageRoot(graph, "graph-adapter"), {
    name: "graph-adapter",
    dependencies: { left: "1.0.0", right: "1.0.0" },
    files: {
      "index.cjs":
        "exports.runGenesProcessor = async () => " +
        "({ left: require('left'), right: require('right') });\n",
    },
  });
  const left = createPackage(packageRoot(graph, "left"), {
    name: "left",
    dependencies: { right: "1.0.0", shared: "1.0.0" },
    files: {
      "index.cjs":
        "exports.name = 'left';\n" +
        "exports.shared = require('shared').version;\n" +
        "exports.peer = require('right').name;\n",
    },
  });
  const right = createPackage(packageRoot(graph, "right"), {
    name: "right",
    dependencies: { left: "1.0.0", shared: "2.0.0" },
    files: {
      "index.cjs":
        "exports.name = 'right';\n" +
        "exports.shared = require('shared').version;\n" +
        "exports.peer = require('left').name;\n",
    },
  });
  createPackage(path.join(left, "node_modules", "shared"), {
    name: "shared",
    version: "1.0.0",
    files: { "index.cjs": "module.exports = { version: 'ONE' };\n" },
  });
  createPackage(path.join(right, "node_modules", "shared"), {
    name: "shared",
    version: "2.0.0",
    files: { "index.cjs": "module.exports = { version: 'TWO' };\n" },
  });
  const graphResult = await executeAdmittedProcessor(
    executionRequest(
      closureRequest(graph, [
        { packageName: "graph-adapter", expectedVersion: "1.0.0" },
      ]),
      "graph-adapter",
      null,
    ),
  );
  assert.deepEqual(graphResult.result, {
    left: { name: "left", peer: "right", shared: "ONE" },
    right: { name: "right", peer: "left", shared: "TWO" },
  });
  assert.equal(graphResult.packageCount, 5);
  assert.equal(graphResult.edgeCount, 6);

  const escape = createProject("genes-execution-escape-");
  createPackage(packageRoot(escape, "escape-adapter"), {
    name: "escape-adapter",
    files: {
      "index.cjs":
        "exports.runGenesProcessor = async (input) => {\n" +
        "  if (input.mode === 'data') return (await import(\"data:text/javascript,export default 'DATA'\")).default;\n" +
        "  if (input.mode === 'network') return (await import('https://example.invalid/module.mjs')).default;\n" +
        "  if (input.mode === 'fetch') return await (await fetch(input.url)).text();\n" +
        "  if (input.mode === 'websocket') return new WebSocket(input.url);\n" +
        "  if (input.mode === 'network-builtin') return typeof require('node:http').request;\n" +
        "  if (input.mode === 'network-builtin-esm') return typeof (await import('node:http')).request;\n" +
        "  if (input.mode === 'network-builtin-direct') return typeof process.getBuiltinModule('http').request;\n" +
        "  if (input.mode === 'network-builtin-esm-direct') return typeof (await import('node:process')).getBuiltinModule('http').request;\n" +
        "  if (input.mode === 'network-private-builtin') return typeof require('_http_client').ClientRequest;\n" +
        "  if (input.mode === 'network-private-builtin-esm') return typeof (await import('_http_client')).ClientRequest;\n" +
        "  if (input.mode === 'network-private-builtin-direct') return await new Promise((resolve, reject) => { const ClientRequest = process.getBuiltinModule('_http_client').ClientRequest; const request = new ClientRequest(input.url, (response) => { let body = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { body += chunk; }); response.on('end', () => resolve(body)); }); request.on('error', reject); request.end(); });\n" +
        "  if (input.mode === 'network-private-binding') return typeof process.binding('tcp_wrap').TCP;\n" +
        "  if (input.mode === 'outside') return require(input.path);\n" +
        "  if (input.mode === 'read') return require('node:fs').readFileSync(input.path, 'utf8');\n" +
        "  if (input.mode === 'native') return require('./fake.node');\n" +
        "  if (input.mode === 'hook') return require('node:module').registerHooks({});\n" +
        "  if (input.mode === 'large') return 'x'.repeat(1024);\n" +
        "  if (input.mode === 'invalid') return () => 'not data';\n" +
        "  if (input.mode === 'timeout') return await new Promise(() => setInterval(() => {}, 1000));\n" +
        "  return 'UNKNOWN';\n" +
        "};\n",
      "fake.node": "not a native addon\n",
    },
  });
  const escapeClosure = closureRequest(escape, [
    { packageName: "escape-adapter", expectedVersion: "1.0.0" },
  ]);
  const outsideFile = path.join(escape, "outside.cjs");
  write(outsideFile, "module.exports = 'OUTSIDE';\n");
  const networkServer = createServer((_request, response) => {
    response.end("NETWORK");
  });
  await new Promise<void>((resolve, reject) => {
    networkServer.once("error", reject);
    networkServer.listen(0, "127.0.0.1", () => {
      networkServer.removeListener("error", reject);
      resolve();
    });
  });
  const networkAddress = networkServer.address();
  assert(networkAddress !== null && typeof networkAddress !== "string");
  try {
    const escapeInputs: readonly ProcessorExecutionData[] = [
      { mode: "data" },
      { mode: "network" },
      { mode: "fetch", url: `http://127.0.0.1:${networkAddress.port}/` },
      { mode: "websocket", url: `ws://127.0.0.1:${networkAddress.port}/` },
      { mode: "network-builtin" },
      { mode: "network-builtin-esm" },
      { mode: "network-builtin-direct" },
      { mode: "network-builtin-esm-direct" },
      {
        mode: "network-private-builtin-direct",
        url: `http://127.0.0.1:${networkAddress.port}/`,
      },
      { mode: "network-private-builtin" },
      { mode: "network-private-builtin-esm" },
      { mode: "network-private-binding" },
      { mode: "outside", path: outsideFile },
      { mode: "read", path: outsideFile },
      { mode: "native" },
      { mode: "hook" },
    ];
    for (const input of escapeInputs) {
      await expectExecutionFailure(
        "execution-module-unadmitted",
        () =>
          executeAdmittedProcessor(
            executionRequest(escapeClosure, "escape-adapter", input),
          ),
        outsideFile,
      );
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      networkServer.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
  }
  await expectExecutionFailure(
    "execution-output-limit",
    () =>
      executeAdmittedProcessor(
        executionRequest(
          escapeClosure,
          "escape-adapter",
          { mode: "large" },
          { ...EXECUTION_LIMITS, maxResultBytes: 16 },
        ),
      ),
  );
  await expectExecutionFailure(
    "execution-result-invalid",
    () =>
      executeAdmittedProcessor(
        executionRequest(escapeClosure, "escape-adapter", {
          mode: "invalid",
        }),
      ),
  );
  await expectExecutionFailure(
    "execution-timeout",
    () =>
      executeAdmittedProcessor(
        executionRequest(
          escapeClosure,
          "escape-adapter",
          { mode: "timeout" },
          { ...EXECUTION_LIMITS, timeoutMs: 100 },
        ),
      ),
  );

  const declaration = createProject("genes-execution-declaration-");
  const declarationAdapter = createPackage(
    packageRoot(declaration, "declaration-adapter"),
    {
      name: "declaration-adapter",
      dependencies: { typescript: "6.0.2" },
      files: {
        "index.cjs":
          "const ts = require('typescript');\n" +
          "exports.runGenesProcessor = async (input) => {\n" +
          "  const source = ts.createSourceFile('styles.d.ts', input.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);\n" +
          "  const declaration = source.statements.find((node) => ts.isInterfaceDeclaration(node) && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword));\n" +
          "  if (!declaration) throw new Error('missing default interface');\n" +
          "  return declaration.members.map((member) => member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) ? member.name.text : null).filter((name) => name !== null).sort();\n" +
          "};\n",
      },
    },
  );
  const typeScriptRoot = realpathSync.native(
    fileURLToPath(new URL("../../node_modules/typescript/", import.meta.url)),
  );
  linkPackage(
    typeScriptRoot,
    path.join(declarationAdapter, "node_modules", "typescript"),
  );
  let declarationMaterializedAt: number | undefined;
  let declarationChildAt: number | undefined;
  let declarationCleanedAt: number | undefined;
  const declarationStartedAt = performance.now();
  const declarationResult = await executeAdmittedProcessorWithHooks(
    executionRequest(
      closureRequest(
        declaration,
        [{ packageName: "declaration-adapter", expectedVersion: "1.0.0" }],
        {
          maxPackages: 8,
          maxEdges: 16,
          maxEntries: 1024,
          maxFiles: 1024,
          maxBytes: 64 * 1024 * 1024,
          maxPathBytes: 1024,
        },
        "genes.test.declaration-admission",
      ),
      "declaration-adapter",
      {
        source:
          "export default interface Styles { readonly title: string; readonly 'card-row': string; }",
      },
    ),
    {
      afterMaterialization: () => {
        declarationMaterializedAt = performance.now();
      },
      afterChild: () => {
        declarationChildAt = performance.now();
      },
      afterCleanup: () => {
        declarationCleanedAt = performance.now();
      },
    },
  );
  const declarationDurationMs = performance.now() - declarationStartedAt;
  assert(declarationMaterializedAt !== undefined);
  assert(declarationChildAt !== undefined);
  assert(declarationCleanedAt !== undefined);
  const declarationMaterializationMs =
    declarationMaterializedAt - declarationStartedAt;
  const declarationChildMs = declarationChildAt - declarationMaterializedAt;
  const declarationCleanupMs = declarationCleanedAt - declarationChildAt;
  assert.deepEqual(declarationResult.result, ["card-row", "title"]);
  assert(declarationResult.totalBytes > 10 * 1024 * 1024);

  console.log(
    `processor-execution-admission:metrics basicMs=${basicDurationMs.toFixed(2)} ` +
      `basicMaterializeMs=${basicMaterializationMs.toFixed(2)} ` +
      `basicChildMs=${basicChildMs.toFixed(2)} basicCleanupMs=${basicCleanupMs.toFixed(2)} ` +
      `basicFiles=${basicResult.fileCount} basicLinks=${basicResult.linkCount} ` +
      `basicBytes=${basicResult.totalBytes} ` +
      `declarationMs=${declarationDurationMs.toFixed(2)} ` +
      `declarationMaterializeMs=${declarationMaterializationMs.toFixed(2)} ` +
      `declarationChildMs=${declarationChildMs.toFixed(2)} ` +
      `declarationCleanupMs=${declarationCleanupMs.toFixed(2)} ` +
      `declarationFiles=${declarationResult.fileCount} ` +
      `declarationLinks=${declarationResult.linkCount} ` +
      `declarationBytes=${declarationResult.totalBytes}`,
  );
  console.log("processor-execution-admission:ok");
} finally {
  for (const root of temporaryRoots.reverse()) {
    rmSync(root, { recursive: true, force: true });
  }
}
