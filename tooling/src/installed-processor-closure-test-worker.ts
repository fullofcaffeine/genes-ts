import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";

import {
  InstalledProcessorClosureError,
  runMeasuredProcessorOperation,
  type InstalledProcessorClosureRequest,
} from "./css-modules/installed-processor-closure.js";

interface WorkerFixtureRequest {
  readonly request: InstalledProcessorClosureRequest;
  readonly packageName: string;
  readonly mutatePath?: string;
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function closureRequest(value: unknown): InstalledProcessorClosureRequest {
  if (
    !record(value) ||
    typeof value.providerKind !== "string" ||
    typeof value.resolutionBaseUrl !== "string" ||
    !Array.isArray(value.roots) ||
    !record(value.limits)
  ) {
    throw new Error("invalid worker closure request");
  }
  const roots = value.roots.map((root: unknown) => {
    if (
      !record(root) ||
      typeof root.packageName !== "string" ||
      (root.resolvedPackageName !== undefined &&
        typeof root.resolvedPackageName !== "string") ||
      typeof root.expectedVersion !== "string"
    ) {
      throw new Error("invalid worker closure root");
    }
    return Object.freeze({
      packageName: root.packageName,
      ...(root.resolvedPackageName === undefined
        ? {}
        : { resolvedPackageName: root.resolvedPackageName }),
      expectedVersion: root.expectedVersion,
    });
  });
  const limits = value.limits;
  const numberValue = (value: unknown): number => {
    if (typeof value !== "number") {
      throw new Error("invalid worker closure limits");
    }
    return value;
  };
  return Object.freeze({
    providerKind: value.providerKind,
    resolutionBaseUrl: value.resolutionBaseUrl,
    roots: Object.freeze(roots),
    limits: Object.freeze({
      maxPackages: numberValue(limits.maxPackages),
      maxEdges: numberValue(limits.maxEdges),
      maxEntries: numberValue(limits.maxEntries),
      maxFiles: numberValue(limits.maxFiles),
      maxBytes: numberValue(limits.maxBytes),
      maxPathBytes: numberValue(limits.maxPathBytes),
    }),
  });
}

function workerFixtureRequest(value: unknown): WorkerFixtureRequest {
  if (
    !record(value) ||
    !record(value.request) ||
    typeof value.packageName !== "string" ||
    (value.mutatePath !== undefined && typeof value.mutatePath !== "string")
  ) {
    throw new Error("invalid worker fixture request");
  }
  return Object.freeze({
    request: closureRequest(value.request),
    packageName: value.packageName,
    ...(value.mutatePath === undefined ? {} : { mutatePath: value.mutatePath }),
  });
}

const rawWorkerData: unknown = workerData;
const data = workerFixtureRequest(rawWorkerData);
if (parentPort === null) throw new Error("worker fixture requires a parent port");

try {
  const measured = await runMeasuredProcessorOperation(data.request, async () => {
    const marker = Symbol.for("genes.test.processor-loaded");
    const loadedBeforeOperation =
      Object.getOwnPropertyDescriptor(globalThis, marker)?.value === true;
    const requirePackage = createRequire(data.request.resolutionBaseUrl);
    const loaded: unknown = requirePackage(data.packageName);
    if (
      !record(loaded) ||
      typeof loaded.value !== "string"
    ) {
      throw new Error("worker fixture package returned an invalid result");
    }
    if (data.mutatePath !== undefined) {
      writeFileSync(
        data.mutatePath,
        'module.exports = { value: "mutated" };\n',
        "utf8",
      );
    }
    return Object.freeze({ result: loaded.value, loadedBeforeOperation });
  });
  parentPort.postMessage({
    ok: true,
    result: measured.result.result,
    loadedBeforeOperation: measured.result.loadedBeforeOperation,
    processorIntegrity: measured.processorIntegrity,
  });
} catch (error) {
  if (error instanceof InstalledProcessorClosureError) {
    parentPort.postMessage({ ok: false, code: error.code, subject: error.subject });
  } else {
    throw error;
  }
}
