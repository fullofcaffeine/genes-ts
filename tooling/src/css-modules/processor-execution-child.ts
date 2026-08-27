import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import {
  createRequire,
  syncBuiltinESMExports,
} from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROTOCOL = "genes.processor-execution-child.v1";
const MAX_CONTROL_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 100_000;
const MAX_DATA_DEPTH = 64;
const MAX_DATA_NODES = 100_000;
const STATE_SYMBOL = Symbol.for("genes.processor-execution-child.state.v1");
const NETWORK_BUILTIN_KEYS = new Set([
  "cluster",
  "dgram",
  "dns",
  "dns/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "inspector/promises",
  "net",
  "quic",
  "tls",
]);
const NETWORK_GLOBAL_KEYS = [
  "EventSource",
  "WebSocket",
  "WebTransport",
  "fetch",
] as const;

type DataValue =
  | null
  | boolean
  | number
  | string
  | readonly DataValue[]
  | { readonly [key: string]: DataValue };

interface ResolveContext {
  readonly parentURL?: string;
  readonly conditions: readonly string[];
  readonly importAttributes: Readonly<Record<string, string>>;
}

interface ResolveResult {
  readonly url: string;
  readonly format?: string;
  readonly shortCircuit?: boolean;
}

type NextResolve = (
  specifier: string,
  context: ResolveContext,
) => ResolveResult;
type NextLoad = (
  url: string,
  context: Readonly<Record<string, unknown>>,
) => unknown;
type BuiltinLookup = (specifier: unknown) => unknown;

interface ChildDescriptor {
  readonly adapterPackageName: string;
  readonly admittedFiles: readonly string[];
  readonly entryDirectory: string;
  readonly input: DataValue;
  readonly maxResultBytes: number;
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectLike(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  );
}

function builtinLookup(value: unknown): value is BuiltinLookup {
  return typeof value === "function";
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function childFailure(code: string): Error {
  const error = new Error(code);
  error.name = "ProcessorExecutionChildError";
  return error;
}

function snapshotData(
  value: unknown,
  state = { nodes: 0 },
  depth = 0,
): DataValue {
  state.nodes += 1;
  if (state.nodes > MAX_DATA_NODES || depth > MAX_DATA_DEPTH) {
    throw childFailure("result-invalid");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw childFailure("result-invalid");
    return value;
  }
  if (Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    const symbols = Object.getOwnPropertySymbols(value);
    const descriptors: Readonly<Record<string, PropertyDescriptor>> =
      Object.getOwnPropertyDescriptors(value);
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
      throw childFailure("result-invalid");
    }
    const result: DataValue[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor)) {
        throw childFailure("result-invalid");
      }
      result.push(snapshotData(descriptor.value, state, depth + 1));
    }
    const extra = Object.keys(descriptors).filter(
      (key) => key !== "length" && !/^(0|[1-9][0-9]*)$/u.test(key),
    );
    if (extra.length > 0) throw childFailure("result-invalid");
    return Object.freeze(result);
  }
  if (!record(value)) throw childFailure("result-invalid");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw childFailure("result-invalid");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw childFailure("result-invalid");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, DataValue> = {};
  const keys = Object.keys(descriptors);
  if (keys.length > MAX_DATA_NODES - state.nodes) {
    throw childFailure("result-invalid");
  }
  keys.sort();
  for (const key of keys) {
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !("value" in descriptor)) {
      throw childFailure("result-invalid");
    }
    Object.defineProperty(result, key, {
      configurable: false,
      enumerable: true,
      value: snapshotData(descriptor.value, state, depth + 1),
      writable: false,
    });
  }
  return Object.freeze(result);
}

function packageKey(value: string): boolean {
  if (value.length === 0 || value.length > 512 || /[\\\u0000-\u001f\u007f]/u.test(value)) {
    return false;
  }
  if (!value.startsWith("@")) {
    return /^(?![._-])[A-Za-z0-9.!'()*_~-]+$/u.test(value);
  }
  const slash = value.indexOf("/");
  return (
    slash > 1 &&
    slash === value.lastIndexOf("/") &&
    /^[A-Za-z0-9.!'()*_~-]+$/u.test(value.slice(1, slash)) &&
    /^(?!\.)[A-Za-z0-9.!'()*_~-]+$/u.test(value.slice(slash + 1))
  );
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function readDescriptor(): ChildDescriptor {
  const descriptorPath = process.argv[2];
  if (descriptorPath === undefined || !path.isAbsolute(descriptorPath)) {
    throw childFailure("invalid-control");
  }
  let bytes: Buffer;
  try {
    const lexical = lstatSync(descriptorPath, { bigint: true });
    if (
      !lexical.isFile() ||
      lexical.isSymbolicLink() ||
      lexical.size > BigInt(MAX_CONTROL_BYTES)
    ) {
      throw childFailure("invalid-control");
    }
    bytes = readFileSync(descriptorPath);
  } catch (error) {
    if (error instanceof Error && error.name === "ProcessorExecutionChildError") {
      throw error;
    }
    throw childFailure("invalid-control");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw childFailure("invalid-control");
  }
  if (!record(decoded) || own(decoded, "protocol") !== PROTOCOL) {
    throw childFailure("invalid-control");
  }
  const adapterPackageName = own(decoded, "adapterPackageName");
  const admittedValue = own(decoded, "admittedFiles");
  const entryValue = own(decoded, "entryDirectory");
  const maxResultBytes = own(decoded, "maxResultBytes");
  if (
    typeof adapterPackageName !== "string" ||
    !packageKey(adapterPackageName) ||
    !Array.isArray(admittedValue) ||
    admittedValue.length === 0 ||
    admittedValue.length > MAX_FILES + 1 ||
    typeof entryValue !== "string" ||
    !path.isAbsolute(entryValue) ||
    typeof maxResultBytes !== "number" ||
    !Number.isSafeInteger(maxResultBytes) ||
    maxResultBytes < 1
  ) {
    throw childFailure("invalid-control");
  }
  const descriptorDirectory = realpathSync.native(path.dirname(descriptorPath));
  const materializedRoot = realpathSync.native(path.dirname(descriptorDirectory));
  const entryDirectory = realpathSync.native(entryValue);
  if (descriptorDirectory !== entryDirectory || !within(materializedRoot, entryDirectory)) {
    throw childFailure("invalid-control");
  }
  const admittedFiles: string[] = [];
  for (const value of admittedValue) {
    if (typeof value !== "string" || !path.isAbsolute(value)) {
      throw childFailure("invalid-control");
    }
    let absolute: string;
    try {
      absolute = realpathSync.native(value);
      const lexical = lstatSync(absolute, { bigint: true });
      if (!lexical.isFile() || lexical.isSymbolicLink()) {
        throw childFailure("invalid-control");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "ProcessorExecutionChildError") {
        throw error;
      }
      throw childFailure("invalid-control");
    }
    if (!within(materializedRoot, absolute)) {
      throw childFailure("invalid-control");
    }
    admittedFiles.push(absolute);
  }
  return Object.freeze({
    adapterPackageName,
    admittedFiles: Object.freeze(admittedFiles),
    entryDirectory,
    input: snapshotData(own(decoded, "input")),
    maxResultBytes,
  });
}

function errorCode(error: unknown): string | undefined {
  if (!record(error)) return undefined;
  const code = own(error, "code");
  return typeof code === "string" ? code : undefined;
}

function moduleFailure(): Error {
  const error = childFailure("module-unadmitted");
  Reflect.set(error, "code", "GENES_MODULE_UNADMITTED");
  return error;
}

function networkBuiltin(specifier: string): boolean {
  const key = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  return NETWORK_BUILTIN_KEYS.has(key);
}

function denyNetworkAccess(): never {
  throw moduleFailure();
}

/**
 * Closes network entry points that do not pass through module resolution.
 *
 * Node's permission model does not restrict sockets. Module hooks can reject
 * `node:http` and its peers, but global fetch/WebSocket and
 * process.getBuiltinModule would otherwise bypass those hooks. Private native
 * bindings are outside the supported adapter contract and are disabled too.
 */
function installNetworkGuards(rawGetBuiltinModule: BuiltinLookup): void {
  Object.defineProperty(process, "getBuiltinModule", {
    configurable: false,
    enumerable: true,
    value: (specifier: unknown): unknown => {
      if (typeof specifier === "string" && networkBuiltin(specifier)) {
        throw moduleFailure();
      }
      return Reflect.apply(rawGetBuiltinModule, process, [specifier]);
    },
    writable: false,
  });
  for (const key of NETWORK_GLOBAL_KEYS) {
    if (Object.getOwnPropertyDescriptor(globalThis, key) === undefined) {
      continue;
    }
    Object.defineProperty(globalThis, key, {
      configurable: false,
      enumerable: false,
      value: denyNetworkAccess,
      writable: false,
    });
  }
  for (const key of ["binding", "_linkedBinding", "dlopen"] as const) {
    if (Object.getOwnPropertyDescriptor(process, key) === undefined) continue;
    Object.defineProperty(process, key, {
      configurable: false,
      enumerable: true,
      value: denyNetworkAccess,
      writable: false,
    });
  }
}

function writeEnvelope(envelope: Readonly<Record<string, unknown>>): void {
  process.stdout.write(JSON.stringify({ protocol: PROTOCOL, ...envelope }));
}

async function main(): Promise<void> {
  const descriptor = readDescriptor();
  const admitted = new Set(descriptor.admittedFiles);
  const require = createRequire(import.meta.url);
  const rawModuleApi: unknown = require("node:module");
  if (!objectLike(rawModuleApi)) throw childFailure("runtime-unsupported");
  const rawRegisterHooks: unknown = Reflect.get(rawModuleApi, "registerHooks");
  if (typeof rawRegisterHooks !== "function") {
    throw childFailure("runtime-unsupported");
  }
  const rawGetBuiltinModule: unknown = Reflect.get(
    process,
    "getBuiltinModule",
  );
  if (!builtinLookup(rawGetBuiltinModule)) {
    throw childFailure("runtime-unsupported");
  }

  const admit = (url: string): void => {
    if (url.startsWith("node:")) {
      if (networkBuiltin(url)) throw moduleFailure();
      return;
    }
    if (!url.startsWith("file:")) throw moduleFailure();
    let absolute: string;
    try {
      absolute = realpathSync.native(fileURLToPath(url));
    } catch {
      throw moduleFailure();
    }
    if (!admitted.has(absolute)) throw moduleFailure();
  };

  const hooks = {
    resolve(
      specifier: string,
      context: ResolveContext,
      nextResolve: NextResolve,
    ): ResolveResult {
      if (
        /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(specifier) &&
        !specifier.startsWith("node:") &&
        !specifier.startsWith("file:")
      ) {
        throw moduleFailure();
      }
      const resolved = nextResolve(specifier, context);
      admit(resolved.url);
      return resolved;
    },
    load(
      url: string,
      context: Readonly<Record<string, unknown>>,
      nextLoad: NextLoad,
    ): unknown {
      admit(url);
      return nextLoad(url, context);
    },
  };
  Reflect.apply(rawRegisterHooks, rawModuleApi, [hooks]);

  for (const key of ["register", "registerHooks"]) {
    Object.defineProperty(rawModuleApi, key, {
      configurable: false,
      enumerable: true,
      value: () => {
        throw moduleFailure();
      },
      writable: false,
    });
  }
  installNetworkGuards(rawGetBuiltinModule);
  syncBuiltinESMExports();

  const state = Object.freeze({
    adapterPackageName: descriptor.adapterPackageName,
    input: descriptor.input,
  });
  Object.defineProperty(globalThis, STATE_SYMBOL, {
    configurable: true,
    enumerable: false,
    value: state,
    writable: false,
  });
  const launcher = path.join(descriptor.entryDirectory, "adapter-launcher.mjs");
  try {
    const loaded = await import(pathToFileURL(launcher).href);
    const result = snapshotData(loaded.default);
    const resultBytes = Buffer.from(JSON.stringify(result), "utf8");
    if (resultBytes.byteLength > descriptor.maxResultBytes) {
      writeEnvelope({ ok: false, code: "result-limit" });
      return;
    }
    writeEnvelope({ ok: true, result });
  } finally {
    Reflect.deleteProperty(globalThis, STATE_SYMBOL);
  }
}

try {
  await main();
} catch (error) {
  const code = errorCode(error);
  if (
    code === "GENES_MODULE_UNADMITTED" ||
    code === "ERR_ACCESS_DENIED" ||
    code === "ERR_DLOPEN_DISABLED" ||
    code === "ERR_MODULE_NOT_FOUND" ||
    code === "MODULE_NOT_FOUND"
  ) {
    writeEnvelope({ ok: false, code: "module-unadmitted" });
  } else if (
    error instanceof Error &&
    error.name === "ProcessorExecutionChildError" &&
    ["invalid-control", "runtime-unsupported", "result-invalid"].includes(error.message)
  ) {
    writeEnvelope({ ok: false, code: error.message });
  } else {
    writeEnvelope({ ok: false, code: "execution-failed" });
  }
  process.exitCode = 1;
}
