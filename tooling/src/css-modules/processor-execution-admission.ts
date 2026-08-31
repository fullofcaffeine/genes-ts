import { spawn } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  materializeInstalledPackageClosureWithHooks,
  type InstalledPackageClosureRequest,
  type InstalledPackageClosureTestHooks,
} from "./installed-package-closure.js";

const CHILD_PROTOCOL = "genes.processor-execution-child.v1";
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_RESULT_BYTES = 16 * 1024 * 1024;
const MAX_CONTROL_BYTES = 64 * 1024 * 1024;
const MAX_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_DATA_DEPTH = 64;
const MAX_DATA_NODES = 100_000;
const MAX_STDERR_BYTES = 64 * 1024;

export type ProcessorExecutionData =
  | null
  | boolean
  | number
  | string
  | readonly ProcessorExecutionData[]
  | { readonly [key: string]: ProcessorExecutionData };

export type ProcessorExecutionFailureCode =
  | "invalid-execution-request"
  | "execution-runtime-unsupported"
  | "execution-module-unadmitted"
  | "execution-timeout"
  | "execution-output-limit"
  | "execution-result-invalid"
  | "execution-failed"
  | "execution-cleanup-failed";

/** One path-free failure from controlled optional processor execution. */
export class ProcessorExecutionAdmissionError extends Error {
  readonly code: ProcessorExecutionFailureCode;
  readonly subject: string;

  constructor(code: ProcessorExecutionFailureCode, subject: string) {
    super(`${code}: ${subject}`);
    this.name = "ProcessorExecutionAdmissionError";
    this.code = code;
    this.subject = subject;
  }
}

export interface ProcessorExecutionLimits {
  readonly maxRequestBytes: number;
  readonly maxResultBytes: number;
  readonly timeoutMs: number;
}

export interface AdmittedProcessorExecutionRequest {
  readonly closure: InstalledPackageClosureRequest;
  /** One fixed measured root exporting runGenesProcessor(input). */
  readonly adapterPackageName: string;
  readonly input: ProcessorExecutionData;
  readonly limits: ProcessorExecutionLimits;
}

export interface AdmittedProcessorExecutionResult {
  readonly processorIntegrity: `sha256-${string}`;
  readonly packageCount: number;
  readonly edgeCount: number;
  readonly entryCount: number;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly linkCount: number;
  readonly result: ProcessorExecutionData;
}

export interface ProcessorExecutionAdmissionTestHooks {
  readonly closure?: InstalledPackageClosureTestHooks;
  readonly afterMaterialization?: (temporaryRoot: string) => void;
  readonly afterChild?: () => void;
  readonly afterCleanup?: () => void;
  readonly nodeVersion?: string;
}

interface ValidatedExecutionRequest {
  readonly closure: InstalledPackageClosureRequest;
  readonly adapterPackageName: string;
  readonly input: ProcessorExecutionData;
  readonly limits: Readonly<ProcessorExecutionLimits>;
}

interface ChildRunResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Buffer;
  readonly timedOut: boolean;
  readonly outputLimited: boolean;
}

function fail(
  code: ProcessorExecutionFailureCode,
  subject: string,
): never {
  throw new ProcessorExecutionAdmissionError(code, subject);
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownValue(
  source: Readonly<Record<string, unknown>>,
  key: string,
  subject: string,
): unknown {
  try {
    if (!Object.hasOwn(source, key)) {
      return fail("invalid-execution-request", subject);
    }
    return Reflect.get(source, key);
  } catch (error) {
    if (error instanceof ProcessorExecutionAdmissionError) throw error;
    return fail("invalid-execution-request", subject);
  }
}

function snapshotData(
  value: unknown,
  subject: string,
  state = { nodes: 0 },
  depth = 0,
): ProcessorExecutionData {
  state.nodes += 1;
  if (state.nodes > MAX_DATA_NODES || depth > MAX_DATA_DEPTH) {
    return fail("invalid-execution-request", subject);
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : fail("invalid-execution-request", subject);
  }
  if (Array.isArray(value)) {
    let prototype: object | null;
    let symbols: readonly symbol[];
    let descriptors: Readonly<Record<string, PropertyDescriptor>>;
    try {
      prototype = Object.getPrototypeOf(value);
      symbols = Object.getOwnPropertySymbols(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      return fail("invalid-execution-request", subject);
    }
    const lengthDescriptor = descriptors["length"];
    if (
      prototype !== Array.prototype ||
      symbols.length > 0 ||
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_DATA_NODES - state.nodes
    ) {
      return fail("invalid-execution-request", subject);
    }
    const result: ProcessorExecutionData[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor)) {
        return fail("invalid-execution-request", subject);
      }
      result.push(snapshotData(descriptor.value, subject, state, depth + 1));
    }
    const extra = Object.keys(descriptors).filter(
      (key) => key !== "length" && !/^(0|[1-9][0-9]*)$/u.test(key),
    );
    if (extra.length > 0) return fail("invalid-execution-request", subject);
    return Object.freeze(result);
  }
  if (!record(value)) return fail("invalid-execution-request", subject);
  let prototype: object | null;
  let symbols: readonly symbol[];
  let descriptors: Readonly<Record<string, PropertyDescriptor>>;
  try {
    prototype = Object.getPrototypeOf(value);
    symbols = Object.getOwnPropertySymbols(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return fail("invalid-execution-request", subject);
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    symbols.length > 0
  ) {
    return fail("invalid-execution-request", subject);
  }
  const result: Record<string, ProcessorExecutionData> = {};
  const keys = Object.keys(descriptors);
  if (keys.length > MAX_DATA_NODES - state.nodes) {
    return fail("invalid-execution-request", subject);
  }
  keys.sort();
  for (const key of keys) {
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !("value" in descriptor)) {
      return fail("invalid-execution-request", subject);
    }
    Object.defineProperty(result, key, {
      configurable: false,
      enumerable: true,
      value: snapshotData(descriptor.value, subject, state, depth + 1),
      writable: false,
    });
  }
  return Object.freeze(result);
}

function positiveInteger(value: unknown, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= maximum
  );
}

function installedClosureRequestCandidate(
  value: unknown,
): value is InstalledPackageClosureRequest {
  // The closure owner performs the complete read-once snapshot. Do not inspect
  // caller-owned fields here and then make that boundary parse them again.
  return record(value);
}

function validateExecutionRequest(
  request: AdmittedProcessorExecutionRequest,
): ValidatedExecutionRequest {
  if (!record(request)) return fail("invalid-execution-request", "request");
  const closure = ownValue(request, "closure", "request");
  const adapterPackageName = ownValue(
    request,
    "adapterPackageName",
    "adapterPackageName",
  );
  const input = ownValue(request, "input", "input");
  const limitsValue = ownValue(request, "limits", "limits");
  if (!installedClosureRequestCandidate(closure) || !record(limitsValue)) {
    return fail("invalid-execution-request", "request");
  }
  if (
    typeof adapterPackageName !== "string" ||
    adapterPackageName.length === 0 ||
    adapterPackageName.length > 512
  ) {
    return fail("invalid-execution-request", "request");
  }
  const maxRequestBytes = ownValue(
    limitsValue,
    "maxRequestBytes",
    "limits",
  );
  const maxResultBytes = ownValue(
    limitsValue,
    "maxResultBytes",
    "limits",
  );
  const timeoutMs = ownValue(limitsValue, "timeoutMs", "limits");
  if (
    !positiveInteger(maxRequestBytes, MAX_REQUEST_BYTES) ||
    !positiveInteger(maxResultBytes, MAX_RESULT_BYTES) ||
    !positiveInteger(timeoutMs, MAX_TIMEOUT_MS)
  ) {
    return fail("invalid-execution-request", "limits");
  }
  const inputSnapshot = snapshotData(input, "input");
  const inputBytes = Buffer.byteLength(JSON.stringify(inputSnapshot), "utf8");
  if (inputBytes > maxRequestBytes) {
    return fail("invalid-execution-request", "maxRequestBytes");
  }
  return Object.freeze({
    closure,
    adapterPackageName,
    input: inputSnapshot,
    limits: Object.freeze({ maxRequestBytes, maxResultBytes, timeoutMs }),
  });
}

function supportedRuntime(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major === 26 && minor >= 1;
}

function launcherSource(): string {
  return `const state = globalThis[Symbol.for("genes.processor-execution-child.state.v1")];\n` +
    `if (state === undefined) throw new Error("missing execution state");\n` +
    `const namespace = await import(state.adapterPackageName);\n` +
    `const direct = namespace.runGenesProcessor;\n` +
    `const fallback = namespace.default?.runGenesProcessor;\n` +
    `const run = typeof direct === "function" ? direct : fallback;\n` +
    `if (typeof run !== "function") throw new Error("adapter contract missing");\n` +
    `export default await run(state.input);\n`;
}

function runChild(
  executable: string,
  arguments_: readonly string[],
  cwd: string,
  timeoutMs: number,
  maxStdoutBytes: number,
): Promise<ChildRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      cwd,
      env: {},
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputLimited = false;
    let spawnError: Error | undefined;
    const stop = (): void => {
      if (!child.killed) child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maxStdoutBytes) {
        outputLimited = true;
        stop();
        return;
      }
      stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_STDERR_BYTES) {
        outputLimited = true;
        stop();
      }
    });
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (spawnError !== undefined) {
        reject(spawnError);
        return;
      }
      resolve(Object.freeze({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout, Math.min(stdoutBytes, maxStdoutBytes)),
        timedOut,
        outputLimited,
      }));
    });
  });
}

function childEnvelope(
  bytes: Buffer,
  subject: string,
): Readonly<Record<string, unknown>> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(bytes.toString("utf8"));
  } catch {
    return fail("execution-result-invalid", subject);
  }
  if (
    !record(decoded) ||
    decoded.protocol !== CHILD_PROTOCOL ||
    typeof decoded.ok !== "boolean"
  ) {
    return fail("execution-result-invalid", subject);
  }
  return decoded;
}

/** Runs one measured adapter package without loading it in the host process. */
export async function executeAdmittedProcessor(
  request: AdmittedProcessorExecutionRequest,
): Promise<AdmittedProcessorExecutionResult> {
  return executeAdmittedProcessorWithHooks(request);
}

/** Internal deterministic race seam; this module is not package-exported. */
export async function executeAdmittedProcessorWithHooks(
  request: AdmittedProcessorExecutionRequest,
  hooks?: ProcessorExecutionAdmissionTestHooks,
): Promise<AdmittedProcessorExecutionResult> {
  const validated = validateExecutionRequest(request);
  if (!supportedRuntime(hooks?.nodeVersion ?? process.versions.node)) {
    return fail("execution-runtime-unsupported", validated.adapterPackageName);
  }

  let temporaryRoot: string;
  try {
    temporaryRoot = realpathSync.native(
      mkdtempSync(
        path.join(realpathSync.native(tmpdir()), "genes-processor-execution-"),
      ),
    );
  } catch {
    return fail("execution-failed", validated.adapterPackageName);
  }

  let failureSubject = validated.adapterPackageName;
  try {
    const materialized = materializeInstalledPackageClosureWithHooks(
      validated.closure,
      temporaryRoot,
      hooks?.closure,
    );
    failureSubject = materialized.providerKind;
    if (!materialized.rootPackageNames.includes(validated.adapterPackageName)) {
      return fail("invalid-execution-request", "adapterPackageName");
    }

    const launcher = path.join(
      materialized.entryDirectory,
      "adapter-launcher.mjs",
    );
    const descriptor = path.join(
      materialized.entryDirectory,
      "execution-request.json",
    );
    try {
      writeFileSync(launcher, launcherSource(), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch {
      return fail("execution-failed", failureSubject);
    }
    const admittedFiles = Object.freeze([
      ...materialized.admittedFiles,
      realpathSync.native(launcher),
    ]);
    const control = JSON.stringify({
      protocol: CHILD_PROTOCOL,
      adapterPackageName: validated.adapterPackageName,
      admittedFiles,
      entryDirectory: materialized.entryDirectory,
      input: validated.input,
      maxResultBytes: validated.limits.maxResultBytes,
    });
    if (Buffer.byteLength(control, "utf8") > MAX_CONTROL_BYTES) {
      return fail("invalid-execution-request", "controlBytes");
    }
    try {
      writeFileSync(descriptor, control, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch {
      return fail("execution-failed", failureSubject);
    }

    hooks?.afterMaterialization?.(temporaryRoot);

    const childPath = realpathSync.native(
      fileURLToPath(new URL("./processor-execution-child.js", import.meta.url)),
    );
    const childDescriptor = lstatSync(childPath, { bigint: true });
    if (!childDescriptor.isFile() || childDescriptor.isSymbolicLink()) {
      return fail("execution-failed", failureSubject);
    }
    let child: ChildRunResult;
    try {
      child = await runChild(
        process.execPath,
        [
          "--permission",
          `--allow-fs-read=${temporaryRoot}`,
          `--allow-fs-read=${childPath}`,
          "--no-addons",
          "--disallow-code-generation-from-strings",
          childPath,
          descriptor,
        ],
        materialized.entryDirectory,
        validated.limits.timeoutMs,
        validated.limits.maxResultBytes + 4096,
      );
    } catch {
      return fail("execution-failed", failureSubject);
    }
    hooks?.afterChild?.();
    if (child.timedOut) {
      return fail("execution-timeout", failureSubject);
    }
    if (child.outputLimited) {
      return fail("execution-output-limit", failureSubject);
    }
    if (child.stdout.byteLength === 0) {
      return fail("execution-failed", failureSubject);
    }
    const envelope = childEnvelope(child.stdout, failureSubject);
    if (envelope.ok !== true) {
      switch (envelope.code) {
        case "module-unadmitted":
          return fail("execution-module-unadmitted", failureSubject);
        case "result-limit":
          return fail("execution-output-limit", failureSubject);
        case "result-invalid":
        case "invalid-control":
          return fail("execution-result-invalid", failureSubject);
        case "runtime-unsupported":
          return fail("execution-runtime-unsupported", failureSubject);
        default:
          return fail("execution-failed", failureSubject);
      }
    }
    if (child.exitCode !== 0 || child.signal !== null || !("result" in envelope)) {
      return fail("execution-failed", failureSubject);
    }
    const result = snapshotData(envelope.result, failureSubject);
    const measurement = materialized.measurement;
    return Object.freeze({
      processorIntegrity: measurement.installedClosureIntegrity,
      packageCount: measurement.packageCount,
      edgeCount: measurement.edgeCount,
      entryCount: measurement.entryCount,
      fileCount: measurement.fileCount,
      totalBytes: measurement.totalBytes,
      linkCount: materialized.linkCount,
      result,
    });
  } finally {
    try {
      rmSync(temporaryRoot, { recursive: true, force: true });
      hooks?.afterCleanup?.();
    } catch {
      return fail("execution-cleanup-failed", failureSubject);
    }
  }
}
