import { createHash } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createGenesDevelopmentSession,
  type AdmissionResult,
  type DevelopmentEvent,
  type JsonValue,
  type ValidationTree,
} from "../session/index.js";
import { runHaxeSync } from "../session/haxe-launch.js";
import { resolveLixLibraryGroup } from "../lix/index.js";

const WATCH_VALIDATION_PROTOCOL = "genes.tooling.watch-validation" as const;
const WATCH_VALIDATION_VERSION = 1 as const;
const WATCH_VALIDATOR_RESULT_INVALID =
  "GENES_WATCH_VALIDATOR_RESULT_INVALID" as const;
const HAXE_VERSION = "4.3.7" as const;
const MAX_FAT_MACH_O_SLICES = 64;
const WATCH_OUTPUT_MAX_PENDING_RECORDS = 1_024;
const WATCH_OUTPUT_MAX_PENDING_BYTES = 8 * 1024 * 1024;
const WATCH_OUTPUT_DRAIN_TIMEOUT_MS = 30_000;

export class WatchCommandUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchCommandUsageError";
  }
}

export interface WatchCommandOptions {
  readonly projectRoot: string;
  readonly projectIdentity: string;
  readonly hxmlFiles: readonly string[];
  readonly publicOutputFile: string;
  readonly stateDirectory: string;
  readonly allowedRoots: readonly string[];
  readonly haxeExecutable: string;
  readonly useLix: boolean;
  readonly validatorModule?: string;
  readonly jsonLines: boolean;
}

interface WatchValidator {
  readonly kind: "haxe-only" | "module";
  readonly label: string;
  readonly policyFacts: JsonValue;
  validate(
    tree: ValidationTree,
    context: { readonly signal: AbortSignal; readonly recovery: boolean },
  ): Promise<AdmissionResult<JsonValue>>;
}

export function watchHelp(): string {
  return `Generate with Genes while source files change.

Usage:
  genes watch --project-id <stable-id> --hxml <build.hxml> --output <entry.js|entry.ts> [options]

Required options:
  --project-id <id>       Stable identity for this project and output owner.
  --hxml <file>           Ordered lowercase .hxml entry. Repeat to add an entry.
  --output <file>         Project-relative public Genes entry file.

Options:
  --root <directory>      Project root. Default: current working directory.
  --state <directory>     Private session state. Default: .genes/dev.
  --allow-root <path>     Additional trusted HXML or source root. Repeatable.
  --haxe <executable>     Native Haxe 4.3.7 binary. Default: haxe.
  --lix                   Resolve HXML libraries through project-installed Lix.
  --validator <module>    Explicit JavaScript validator module.
  --json-lines            Write only DevelopmentEvent v1 records to stdout.
  -h, --help              Show this help.

Without --validator, successful Haxe and Genes generation is admitted without
an additional host check. The command labels that mode as Haxe-only admission.
It never starts a framework server or runs a validator through a shell.
`;
}

function takeValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined) {
    throw new WatchCommandUsageError(`${option} requires a value.`);
  }
  return value;
}

function assignOnce(
  current: string | undefined,
  value: string,
  option: string,
): string {
  if (current !== undefined) {
    throw new WatchCommandUsageError(`${option} can be specified only once.`);
  }
  if (value.length === 0) {
    throw new WatchCommandUsageError(`${option} cannot be empty.`);
  }
  return value;
}

function checkedHxmlArgument(value: string): string {
  if (value.trim().length === 0 || !value.endsWith(".hxml")) {
    throw new WatchCommandUsageError(
      "--hxml requires a non-empty path ending in .hxml.",
    );
  }
  return value;
}

export function parseWatchArguments(
  args: readonly string[],
  currentDirectory: string = process.cwd(),
): WatchCommandOptions {
  let root: string | undefined;
  let projectIdentity: string | undefined;
  let output: string | undefined;
  let state: string | undefined;
  let haxe: string | undefined;
  let validator: string | undefined;
  let jsonLines = false;
  let useLix = false;
  const hxmlFiles: string[] = [];
  const allowedRoots: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--root":
        root = assignOnce(root, takeValue(args, index, argument), argument);
        index += 1;
        break;
      case "--project-id":
        projectIdentity = assignOnce(
          projectIdentity,
          takeValue(args, index, argument),
          argument,
        );
        index += 1;
        break;
      case "--hxml":
        hxmlFiles.push(checkedHxmlArgument(takeValue(args, index, argument)));
        index += 1;
        break;
      case "--output":
        output = assignOnce(output, takeValue(args, index, argument), argument);
        index += 1;
        break;
      case "--state":
        state = assignOnce(state, takeValue(args, index, argument), argument);
        index += 1;
        break;
      case "--allow-root":
        allowedRoots.push(takeValue(args, index, argument));
        index += 1;
        break;
      case "--haxe":
        haxe = assignOnce(haxe, takeValue(args, index, argument), argument);
        index += 1;
        break;
      case "--validator":
        validator = assignOnce(
          validator,
          takeValue(args, index, argument),
          argument,
        );
        index += 1;
        break;
      case "--lix":
        if (useLix) {
          throw new WatchCommandUsageError("--lix can be specified only once.");
        }
        useLix = true;
        break;
      case "--json-lines":
        if (jsonLines) {
          throw new WatchCommandUsageError(
            "--json-lines can be specified only once.",
          );
        }
        jsonLines = true;
        break;
      default:
        throw new WatchCommandUsageError(
          `Unknown genes watch argument: ${argument ?? ""}`,
        );
    }
  }

  if (projectIdentity === undefined) {
    throw new WatchCommandUsageError("--project-id is required.");
  }
  if (hxmlFiles.length === 0) {
    throw new WatchCommandUsageError("At least one --hxml entry is required.");
  }
  if (output === undefined) {
    throw new WatchCommandUsageError("--output is required.");
  }

  return Object.freeze({
    projectRoot: path.resolve(currentDirectory, root ?? "."),
    projectIdentity,
    hxmlFiles: Object.freeze([...hxmlFiles]),
    publicOutputFile: output,
    stateDirectory: state ?? ".genes/dev",
    allowedRoots: Object.freeze([...allowedRoots]),
    haxeExecutable: haxe ?? "haxe",
    useLix,
    ...(validator === undefined ? {} : { validatorModule: validator }),
    jsonLines,
  });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new WatchCommandUsageError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function copyJsonValue(
  value: unknown,
  label: string,
  ancestors: Set<object> = new Set(),
  depth: number = 0,
): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new WatchCommandUsageError(`${label} contains a non-finite number.`);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new WatchCommandUsageError(`${label} must contain only JSON values.`);
  }
  if (depth >= 64) {
    throw new WatchCommandUsageError(`${label} exceeds the JSON depth limit.`);
  }
  if (ancestors.has(value)) {
    throw new WatchCommandUsageError(`${label} contains a cycle.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(
        value.map((entry, index) =>
          copyJsonValue(entry, `${label}[${index}]`, ancestors, depth + 1),
        ),
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new WatchCommandUsageError(`${label} must contain plain objects.`);
    }
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          copyJsonValue(entry, `${label}.${key}`, ancestors, depth + 1),
        ]),
      ),
    );
  } finally {
    ancestors.delete(value);
  }
}

function checkedAdmission(value: unknown): AdmissionResult<JsonValue> {
  const result = record(value, "validator result");
  if (result.ok === true) {
    const extras = Object.keys(result).filter((key) => key !== "ok");
    if (extras.length !== 0) {
      throw new WatchCommandUsageError(
        "A genes watch validator may only accept with { ok: true }.",
      );
    }
    return Object.freeze({ ok: true });
  }
  if (result.ok === false) {
    const extras = Object.keys(result).filter(
      (key) => key !== "ok" && key !== "diagnostic",
    );
    if (extras.length !== 0 || !("diagnostic" in result)) {
      throw new WatchCommandUsageError(
        "A rejected genes watch result requires only ok and diagnostic.",
      );
    }
    return Object.freeze({
      ok: false,
      diagnostic: copyJsonValue(result.diagnostic, "validator diagnostic"),
    });
  }
  throw new WatchCommandUsageError(
    "A genes watch validator must return { ok: true } or { ok: false, diagnostic }.",
  );
}

function invalidValidatorResult(message: string): AdmissionResult<JsonValue> {
  return Object.freeze({
    ok: false,
    diagnostic: Object.freeze({
      protocol: WATCH_VALIDATION_PROTOCOL,
      version: WATCH_VALIDATION_VERSION,
      code: WATCH_VALIDATOR_RESULT_INVALID,
      message,
    }),
  });
}

function portableRelative(root: string, file: string): string {
  const relative = path.relative(root, file);
  return relative.split(path.sep).join("/");
}

export async function loadWatchValidator(
  projectRoot: string,
  modulePath?: string,
  onInvalidResultShape: (message: string) => void = () => undefined,
): Promise<WatchValidator> {
  if (modulePath === undefined) {
    return Object.freeze({
      kind: "haxe-only",
      label: "Haxe-only admission (no host validator)",
      policyFacts: Object.freeze({
        protocol: WATCH_VALIDATION_PROTOCOL,
        version: WATCH_VALIDATION_VERSION,
        kind: "haxe-only",
      }),
      validate: async () => Object.freeze({ ok: true }),
    });
  }

  const absolute = path.resolve(projectRoot, modulePath);
  let canonical: string;
  try {
    const stats = statSync(absolute);
    if (!stats.isFile()) {
      throw new Error("not a regular file");
    }
    canonical = realpathSync.native(absolute);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WatchCommandUsageError(
      `Cannot read validator module ${modulePath}: ${message}`,
    );
  }
  const moduleRelative = path.relative(projectRoot, canonical);
  if (
    moduleRelative === ".." ||
    moduleRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(moduleRelative)
  ) {
    throw new WatchCommandUsageError(
      "The validator module must stay inside the project root.",
    );
  }
  const bytes = readFileSync(canonical);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const url = pathToFileURL(canonical);
  url.searchParams.set("genes-watch-digest", digest);
  let imported: unknown;
  try {
    imported = await import(url.href);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WatchCommandUsageError(
      `Cannot load validator module ${modulePath}: ${message}`,
    );
  }
  let loadedDigest: string;
  try {
    loadedDigest = createHash("sha256")
      .update(readFileSync(canonical))
      .digest("hex");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WatchCommandUsageError(
      `Cannot verify validator module ${modulePath} after loading: ${message}`,
    );
  }
  if (loadedDigest !== digest) {
    throw new WatchCommandUsageError(
      `Validator module ${modulePath} changed while it was loading; restart with stable reviewed bytes.`,
    );
  }
  const namespace = record(imported, "validator module namespace");
  const definition = record(
    namespace.default,
    "validator module default export",
  );
  if (typeof definition.validate !== "function") {
    throw new WatchCommandUsageError(
      "The validator module default export requires a validate function.",
    );
  }
  if (!("policyFacts" in definition)) {
    throw new WatchCommandUsageError(
      "The validator module default export requires JSON policyFacts.",
    );
  }
  const facts = copyJsonValue(
    definition.policyFacts,
    "validator module policyFacts",
  );
  const validate = definition.validate as (
    tree: ValidationTree,
    context: { readonly signal: AbortSignal; readonly recovery: boolean },
  ) => unknown | Promise<unknown>;
  const label = portableRelative(projectRoot, canonical);
  return Object.freeze({
    kind: "module",
    label,
    policyFacts: Object.freeze({
      protocol: WATCH_VALIDATION_PROTOCOL,
      version: WATCH_VALIDATION_VERSION,
      kind: "module",
      module: label,
      moduleDigest: digest,
      facts,
    }),
    validate: async (
      tree: ValidationTree,
      context: { readonly signal: AbortSignal; readonly recovery: boolean },
    ) => {
      const result = await validate(tree, context);
      try {
        return checkedAdmission(result);
      } catch (error) {
        if (error instanceof WatchCommandUsageError) {
          onInvalidResultShape(error.message);
          return invalidValidatorResult(error.message);
        }
        throw error;
      }
    },
  });
}

function environmentSnapshot(): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  );
}

function resolveExecutable(
  executable: string,
  projectRoot: string,
  environment: Readonly<Record<string, string>>,
): string {
  const hasPathSeparator = executable.includes("/") || executable.includes("\\");
  const candidates = hasPathSeparator
    ? [path.resolve(projectRoot, executable)]
    : (environment.PATH ?? "")
        .split(path.delimiter)
        .filter((entry) => entry.length > 0)
        .flatMap((directory) => {
          if (process.platform !== "win32") return [path.join(directory, executable)];
          if (path.extname(executable).length > 0) {
            return [path.join(directory, executable)];
          }
          const extensions = (environment.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
            .split(";")
            .filter((extension) => extension.length > 0);
          return extensions.map((extension) =>
            path.join(directory, `${executable}${extension.toLowerCase()}`),
          );
        });
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync.native(candidate);
    } catch {
      // Continue to the next exact PATH entry.
    }
  }
  throw new WatchCommandUsageError(`Cannot find Haxe executable ${executable}.`);
}

interface ExecutableFileIdentity {
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly modifiedAt: number;
  readonly changedAt: number;
}

function readExecutableRange(
  descriptor: number,
  fileSize: number,
  position: number,
  length: number,
): Buffer | undefined {
  if (
    !Number.isSafeInteger(position) ||
    position < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    position > fileSize - length
  ) {
    return undefined;
  }
  const bytes = Buffer.alloc(length);
  return readSync(descriptor, bytes, 0, length, position) === length
    ? bytes
    : undefined;
}

function uint64(
  bytes: Buffer,
  offset: number,
  littleEndian: boolean,
): number | undefined {
  const value = littleEndian
    ? bytes.readBigUInt64LE(offset)
    : bytes.readBigUInt64BE(offset);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}

function isElfExecutable(
  descriptor: number,
  fileSize: number,
): boolean {
  const header = readExecutableRange(descriptor, fileSize, 0, 20);
  if (
    header === undefined ||
    !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
    (header[4] !== 1 && header[4] !== 2) ||
    (header[5] !== 1 && header[5] !== 2) ||
    header[6] !== 1
  ) {
    return false;
  }
  const type = header[5] === 1
    ? header.readUInt16LE(16)
    : header.readUInt16BE(16);
  return type === 2 || type === 3;
}

function thinMachOEndian(header: Buffer): "little" | "big" | undefined {
  switch (header.subarray(0, 4).toString("hex")) {
    case "feedface":
    case "feedfacf":
      return "big";
    case "cefaedfe":
    case "cffaedfe":
      return "little";
    default:
      return undefined;
  }
}

function isThinMachOExecutable(
  descriptor: number,
  fileSize: number,
  position: number,
): boolean {
  const header = readExecutableRange(descriptor, fileSize, position, 16);
  if (header === undefined) return false;
  const endian = thinMachOEndian(header);
  if (endian === undefined) return false;
  const fileType = endian === "little"
    ? header.readUInt32LE(12)
    : header.readUInt32BE(12);
  return fileType === 2;
}

function isMachOExecutable(
  descriptor: number,
  fileSize: number,
): boolean {
  if (isThinMachOExecutable(descriptor, fileSize, 0)) return true;
  const header = readExecutableRange(descriptor, fileSize, 0, 8);
  if (header === undefined) return false;
  const magic = header.subarray(0, 4).toString("hex");
  const littleEndian = magic === "bebafeca" || magic === "bfbafeca";
  const sixtyFourBit = magic === "cafebabf" || magic === "bfbafeca";
  if (
    magic !== "cafebabe" &&
    magic !== "bebafeca" &&
    magic !== "cafebabf" &&
    magic !== "bfbafeca"
  ) {
    return false;
  }
  const sliceCount = littleEndian
    ? header.readUInt32LE(4)
    : header.readUInt32BE(4);
  if (sliceCount === 0 || sliceCount > MAX_FAT_MACH_O_SLICES) return false;
  const entryBytes = sixtyFourBit ? 32 : 20;
  const entries = readExecutableRange(
    descriptor,
    fileSize,
    8,
    sliceCount * entryBytes,
  );
  if (entries === undefined) return false;
  for (let index = 0; index < sliceCount; index += 1) {
    const entry = index * entryBytes;
    const position = sixtyFourBit
      ? uint64(entries, entry + 8, littleEndian)
      : littleEndian
        ? entries.readUInt32LE(entry + 8)
        : entries.readUInt32BE(entry + 8);
    const size = sixtyFourBit
      ? uint64(entries, entry + 16, littleEndian)
      : littleEndian
        ? entries.readUInt32LE(entry + 12)
        : entries.readUInt32BE(entry + 12);
    if (
      position !== undefined &&
      size !== undefined &&
      size >= 16 &&
      position <= fileSize - size &&
      isThinMachOExecutable(descriptor, fileSize, position)
    ) {
      return true;
    }
  }
  return false;
}

function isPeExecutable(
  descriptor: number,
  fileSize: number,
  executable: string,
): boolean {
  if (!executable.toLowerCase().endsWith(".exe")) return false;
  const dos = readExecutableRange(descriptor, fileSize, 0, 64);
  if (dos === undefined || dos.subarray(0, 2).toString("ascii") !== "MZ") {
    return false;
  }
  const peOffset = dos.readUInt32LE(0x3c);
  const header = readExecutableRange(descriptor, fileSize, peOffset, 26);
  if (
    header === undefined ||
    header.subarray(0, 4).toString("binary") !== "PE\0\0" ||
    header.readUInt16LE(20) < 2 ||
    (header.readUInt16LE(22) & 0x0002) === 0
  ) {
    return false;
  }
  const optionalMagic = header.readUInt16LE(24);
  return optionalMagic === 0x010b || optionalMagic === 0x020b;
}

function executableIdentity(
  descriptor: number,
): ExecutableFileIdentity | undefined {
  const stats = fstatSync(descriptor);
  if (!stats.isFile()) return undefined;
  return Object.freeze({
    device: stats.dev,
    inode: stats.ino,
    size: stats.size,
    modifiedAt: stats.mtimeMs,
    changedAt: stats.ctimeMs,
  });
}

/**
 * Classifies bounded current-platform executable headers before admission.
 * Raw-exec launch, not this classifier, prevents POSIX shell fallback.
 * This check does not attest a trusted compiler binary.
 */
function inspectNativeExecutable(
  executable: string,
  platform: NodeJS.Platform,
): ExecutableFileIdentity | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(executable, "r");
    const identity = executableIdentity(descriptor);
    if (identity === undefined) return undefined;
    const valid = platform === "linux"
      ? isElfExecutable(descriptor, identity.size)
      : platform === "darwin"
        ? isMachOExecutable(descriptor, identity.size)
        : platform === "win32"
          ? isPeExecutable(descriptor, identity.size, executable)
          : false;
    return valid ? identity : undefined;
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function inspectNativeExecutableFile(
  executable: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return inspectNativeExecutable(executable, platform) !== undefined;
}

function sameExecutableIdentity(
  before: ExecutableFileIdentity,
  after: ExecutableFileIdentity,
): boolean {
  return before.device === after.device &&
    before.inode === after.inode &&
    before.size === after.size &&
    before.modifiedAt === after.modifiedAt &&
    before.changedAt === after.changedAt;
}

function probeHaxe(
  executable: string,
  projectRoot: string,
  environment: Readonly<Record<string, string>>,
): string {
  const probe = runHaxeSync(executable, ["--version"], {
    cwd: projectRoot,
    environment,
    timeoutMs: 10_000,
  });
  if (probe.error !== undefined || probe.status !== 0) {
    const detail = probe.error?.message ?? probe.stderr.trim() ?? "unknown failure";
    throw new WatchCommandUsageError(
      `Cannot run ${executable} --version: ${detail}`,
    );
  }
  return probe.stdout.trim();
}

function checkHaxe(
  executable: string,
  projectRoot: string,
): {
  readonly executable: string;
  readonly version: string;
  readonly environment: Readonly<Record<string, string>>;
} {
  const environment = environmentSnapshot();
  const selected = resolveExecutable(executable, projectRoot, environment);
  const admit = (
    candidate: string,
  ): { readonly executable: string; readonly version: string } | undefined => {
    let canonical: string;
    try {
      canonical = realpathSync.native(candidate);
      accessSync(canonical, constants.X_OK);
    } catch {
      return undefined;
    }
    const before = inspectNativeExecutable(canonical, process.platform);
    if (before === undefined) return undefined;
    const version = probeHaxe(canonical, projectRoot, environment);
    const after = inspectNativeExecutable(canonical, process.platform);
    if (after === undefined || !sameExecutableIdentity(before, after)) {
      throw new WatchCommandUsageError(
        `Haxe executable ${canonical} changed while genes watch admitted it.`,
      );
    }
    return Object.freeze({ executable: canonical, version });
  };

  const selectedNative = admit(selected);
  if (selectedNative !== undefined) {
    if (selectedNative.version !== HAXE_VERSION) {
      throw new WatchCommandUsageError(
        `genes watch requires Haxe ${HAXE_VERSION}; ${executable} reported ${selectedNative.version || "no version"}.`,
      );
    }
    return Object.freeze({
      ...selectedNative,
      environment,
    });
  }

  const executableName = process.platform === "win32" ? "haxe.exe" : "haxe";
  const managedCandidates = [
    ...(environment.HAXE_STD_PATH === undefined ||
        environment.HAXE_STD_PATH.length === 0
      ? []
      : [path.join(path.dirname(environment.HAXE_STD_PATH), executableName)]),
    path.join(homedir(), "haxe", "versions", HAXE_VERSION, executableName),
  ];
  for (const candidate of [...new Set(managedCandidates)]) {
    const managed = admit(candidate);
    if (managed !== undefined && managed.version === HAXE_VERSION) {
      return Object.freeze({ ...managed, environment });
    }
  }

  throw new WatchCommandUsageError(
    `genes watch requires a native Haxe ${HAXE_VERSION} executable; use --haxe with the native compiler binary.`,
  );
}

interface LixConfiguration {
  readonly entry: string;
  readonly version: string;
  readonly packageDigest: string;
}

function loadLix(projectRoot: string): LixConfiguration {
  const requireFromProject = createRequire(path.join(projectRoot, "package.json"));
  let entry: string;
  let packageFile: string;
  try {
    entry = requireFromProject.resolve("lix/bin/haxelibshim.js");
    packageFile = requireFromProject.resolve("lix/package.json");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WatchCommandUsageError(
      `--lix requires the project-installed lix package: ${message}`,
    );
  }
  let decoded: unknown;
  const packageBytes = readFileSync(packageFile);
  try {
    decoded = JSON.parse(packageBytes.toString("utf8"));
  } catch {
    throw new WatchCommandUsageError("The installed lix package.json is invalid.");
  }
  const manifest = record(decoded, "installed lix package.json");
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new WatchCommandUsageError(
      "The installed lix package.json has no version.",
    );
  }
  return Object.freeze({
    entry: realpathSync.native(entry),
    version: manifest.version,
    packageDigest: createHash("sha256").update(packageBytes).digest("hex"),
  });
}

function diagnosticText(diagnostic: JsonValue): string {
  if (
    diagnostic !== null &&
    !Array.isArray(diagnostic) &&
    typeof diagnostic === "object"
  ) {
    const message = (diagnostic as { readonly [key: string]: JsonValue })[
      "message"
    ];
    if (typeof message === "string") return message;
  }
  return JSON.stringify(diagnostic);
}

export function formatWatchEvent(event: DevelopmentEvent<JsonValue>): string | null {
  if (event.event.kind === "compiler-lifecycle") {
    const lifecycle = event.event.event;
    if (lifecycle.kind === "started") {
      return `COMPILER READY ${lifecycle.endpoint.host}:${lifecycle.endpoint.port}`;
    }
    if (lifecycle.kind === "fallback") {
      return `COMPILER DIRECT ${lifecycle.reason}`;
    }
    return `COMPILER ${lifecycle.kind.toUpperCase()} pid=${lifecycle.pid}`;
  }
  if (event.event.kind !== "state") return null;
  const state = event.event.state;
  switch (state.kind) {
    case "opening":
      return "OPENING";
    case "building":
      return `BUILDING revision=${state.revision}`;
    case "blocked":
      return `BLOCKED phase=${state.failure.phase} recoverable=${String(state.failure.recoverable)} ${diagnosticText(state.failure.diagnostic)}`;
    case "ready":
      return `READY generation=${state.accepted.generation} revision=${state.accepted.revision}`;
    case "degraded":
      return `DEGRADED generation=${state.accepted.generation} phase=${state.failure.phase} ${diagnosticText(state.failure.diagnostic)}`;
    case "closing":
      return "CLOSING";
    case "closed":
      return "CLOSED";
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function selectWatchExitCode(
  current: number | undefined,
  requested: number,
): number {
  if (current === undefined || requested === 1) return requested;
  if (current === 1) return current;
  if (requested === 2) return requested;
  if (current === 2) return current;
  return current;
}

export function watchOutputErrorExitCode(error: unknown): 0 | 1 {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "EPIPE"
    ? 0
    : 1;
}

interface WatchOutputStream {
  write(
    chunk: Buffer,
    callback: (error?: Error | null) => void,
  ): boolean;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "drain", listener: () => void): this;
  removeListener(event: "error", listener: (error: Error) => void): this;
  removeListener(event: "drain", listener: () => void): this;
  destroy(): void;
}

export interface WatchOutputFailure {
  readonly exitCode: 0 | 1;
  readonly message: string;
}

export interface WatchOutputWriterOptions {
  readonly maxPendingRecords: number;
  readonly maxPendingBytes: number;
  readonly drainTimeoutMs: number;
  readonly onFailure: (failure: WatchOutputFailure) => void;
}

/**
 * Bridges synchronous development events to a backpressured Node writable.
 * The queue retains one ordered prefix and fails closed instead of dropping
 * records or growing for the lifetime of a watch process.
 */
export class WatchOutputWriter {
  readonly #stream: WatchOutputStream;
  readonly #options: WatchOutputWriterOptions;
  readonly #pending: Buffer[] = [];
  readonly #finishPromise: Promise<void>;
  readonly #resolveFinish: () => void;
  readonly #reportedFailures = new Set<string>();
  #pendingBytes = 0;
  #writesInFlight = 0;
  #blocked = false;
  #accepting = true;
  #aborted = false;
  #finishing = false;
  #finishResolved = false;
  #disposed = false;
  #drainTimer: NodeJS.Timeout | undefined;

  readonly #onDrain = (): void => {
    if (this.#aborted || !this.#blocked) return;
    this.#blocked = false;
    this.#pump();
  };

  readonly #onError = (error: Error): void => {
    this.#abort(
      watchOutputErrorExitCode(error),
      `stdout failed: ${errorText(error)}`,
    );
  };

  constructor(stream: WatchOutputStream, options: WatchOutputWriterOptions) {
    if (
      !Number.isSafeInteger(options.maxPendingRecords) ||
      options.maxPendingRecords <= 0 ||
      !Number.isSafeInteger(options.maxPendingBytes) ||
      options.maxPendingBytes <= 0 ||
      !Number.isSafeInteger(options.drainTimeoutMs) ||
      options.drainTimeoutMs <= 0
    ) {
      throw new Error("Watch output limits must be positive safe integers.");
    }
    this.#stream = stream;
    this.#options = options;
    let resolveFinish: (() => void) | undefined;
    this.#finishPromise = new Promise<void>((resolve) => {
      resolveFinish = resolve;
    });
    this.#resolveFinish = () => resolveFinish?.();
    stream.on("error", this.#onError);
    stream.on("drain", this.#onDrain);
  }

  writeLine(line: string): void {
    if (!this.#accepting) return;
    let lineBytes: number;
    try {
      lineBytes = Buffer.byteLength(line, "utf8");
    } catch (error) {
      this.fail(error, "cannot measure stdout record");
      return;
    }
    const recordBytes = lineBytes + 1;
    if (recordBytes > this.#options.maxPendingBytes) {
      this.#accepting = false;
      this.#reportFailure({
        exitCode: 1,
        message:
          `stdout record exceeded ${this.#options.maxPendingBytes} bytes; closing before write`,
      });
      return;
    }
    let record: Buffer;
    try {
      record = Buffer.allocUnsafe(recordBytes);
      const written = record.write(line, 0, lineBytes, "utf8");
      if (written !== lineBytes) {
        throw new Error("stdout record encoding was incomplete");
      }
      record[lineBytes] = 0x0a;
    } catch (error) {
      this.fail(error, "cannot encode stdout record");
      return;
    }
    if (!this.#blocked) {
      this.#write(record);
      return;
    }
    if (
      this.#pending.length + 1 > this.#options.maxPendingRecords ||
      this.#pendingBytes + record.byteLength > this.#options.maxPendingBytes
    ) {
      this.#accepting = false;
      this.#reportFailure({
        exitCode: 1,
        message:
          `stdout backpressure exceeded ${this.#options.maxPendingRecords} records and ${this.#options.maxPendingBytes} bytes; closing without dropping the retained prefix`,
      });
      return;
    }
    this.#pending.push(record);
    this.#pendingBytes += record.byteLength;
  }

  fail(error: unknown, context: string): void {
    this.#abort(1, `${context}: ${errorText(error)}`);
  }

  async finish(): Promise<void> {
    if (!this.#finishing) {
      this.#finishing = true;
      this.#accepting = false;
      this.#settleFinish();
      if (!this.#finishResolved) {
        this.#drainTimer = setTimeout(() => {
          this.#drainTimer = undefined;
          this.#pending.length = 0;
          this.#pendingBytes = 0;
          this.#blocked = false;
          this.#aborted = true;
          try {
            this.#stream.destroy();
          } catch {
            // The timeout is already the authoritative output failure.
          }
          this.#reportFailure({
            exitCode: 1,
            message:
              `stdout did not drain within ${this.#options.drainTimeoutMs} ms; the output stream was closed`,
          });
          this.#settleFinish();
        }, this.#options.drainTimeoutMs);
      }
    }
    await this.#finishPromise;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#drainTimer !== undefined) clearTimeout(this.#drainTimer);
    this.#stream.removeListener("error", this.#onError);
    this.#stream.removeListener("drain", this.#onDrain);
  }

  #write(record: Buffer): void {
    this.#writesInFlight += 1;
    let callbackObserved = false;
    try {
      const writable = this.#stream.write(record, (error) => {
        if (callbackObserved) return;
        callbackObserved = true;
        this.#writesInFlight -= 1;
        if (error !== undefined && error !== null) {
          this.#abort(
            watchOutputErrorExitCode(error),
            `stdout write failed: ${errorText(error)}`,
          );
        }
        this.#settleFinish();
      });
      if (!writable) this.#blocked = true;
    } catch (error) {
      if (!callbackObserved) {
        callbackObserved = true;
        this.#writesInFlight -= 1;
      }
      this.#abort(
        watchOutputErrorExitCode(error),
        `stdout write failed: ${errorText(error)}`,
      );
    }
  }

  #pump(): void {
    while (!this.#aborted && !this.#blocked && this.#pending.length > 0) {
      const record = this.#pending.shift();
      if (record === undefined) break;
      this.#pendingBytes -= record.byteLength;
      this.#write(record);
    }
    this.#settleFinish();
  }

  #abort(exitCode: 0 | 1, message: string): void {
    if (this.#aborted) return;
    this.#accepting = false;
    this.#aborted = true;
    this.#blocked = false;
    this.#pending.length = 0;
    this.#pendingBytes = 0;
    this.#reportFailure({ exitCode, message });
    this.#settleFinish();
  }

  #reportFailure(failure: WatchOutputFailure): void {
    const key = `${failure.exitCode}:${failure.message}`;
    if (this.#reportedFailures.has(key)) return;
    this.#reportedFailures.add(key);
    this.#options.onFailure(Object.freeze(failure));
  }

  #settleFinish(): void {
    if (
      !this.#finishing ||
      this.#finishResolved ||
      (!this.#aborted &&
        (this.#blocked ||
          this.#pending.length !== 0 ||
          this.#writesInFlight !== 0))
    ) {
      return;
    }
    this.#finishResolved = true;
    if (this.#drainTimer !== undefined) {
      clearTimeout(this.#drainTimer);
      this.#drainTimer = undefined;
    }
    this.#resolveFinish();
  }
}

function checkedProjectRoot(projectRootOption: string): string {
  const absolute = path.resolve(projectRootOption);
  let canonical: string;
  try {
    const root = path.parse(absolute).root;
    const relative = absolute.slice(root.length);
    const components = relative.length === 0 ? [] : relative.split(path.sep);
    let current = root;
    if (components.length === 0) {
      const stats = lstatSync(current);
      if (stats.isSymbolicLink()) {
        throw new WatchCommandUsageError(
          "projectRoot must not traverse a symbolic link",
        );
      }
      if (!stats.isDirectory()) {
        throw new WatchCommandUsageError("projectRoot must be a real directory");
      }
    }
    for (const component of components) {
      current = path.join(current, component);
      const stats = lstatSync(current);
      if (stats.isSymbolicLink()) {
        throw new WatchCommandUsageError(
          "projectRoot must not traverse a symbolic link",
        );
      }
      if (!stats.isDirectory()) {
        throw new WatchCommandUsageError("projectRoot must be a real directory");
      }
    }
    canonical = realpathSync.native(absolute);
  } catch (error) {
    if (error instanceof WatchCommandUsageError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new WatchCommandUsageError(
      `projectRoot must be a real directory: ${message}`,
    );
  }
  return canonical;
}

export async function runWatchCommand(
  options: WatchCommandOptions,
): Promise<number> {
  const projectRoot = checkedProjectRoot(options.projectRoot);
  const haxe = checkHaxe(options.haxeExecutable, projectRoot);
  const lix = options.useLix ? loadLix(projectRoot) : undefined;
  let handleInvalidResultShape = (_message: string): void => undefined;
  const validator = await loadWatchValidator(
    projectRoot,
    options.validatorModule,
    (message) => handleInvalidResultShape(message),
  );
  const allowedRoots = Object.freeze([
    projectRoot,
    ...options.allowedRoots.map((root) => path.resolve(projectRoot, root)),
  ]);
  const session = createGenesDevelopmentSession<JsonValue>({
    projectRoot,
    projectIdentity: options.projectIdentity,
    hxml: {
      allowedRoots,
      ...(lix === undefined
        ? {}
        : {
            resolveLibraries: (requests, context) =>
              resolveLixLibraryGroup({
                projectRoot,
                requests,
                command: {
                  executable: process.execPath,
                  argsPrefix: [lix.entry],
                  environment: haxe.environment,
                },
                signal: context.signal,
              }),
          }),
    },
    publicOutputFile: options.publicOutputFile,
    stateDirectory: options.stateDirectory,
    resolveInvocation: async () => Object.freeze({
      executable: haxe.executable,
      cwd: projectRoot,
      args: options.hxmlFiles,
      env: haxe.environment,
      ioPolicy: "haxe-4.3.7-development-js-v1",
      compatibilityFacts: Object.freeze({
        command: "genes-watch",
        version: 1,
        haxe: haxe.version,
        lix: lix === undefined
          ? null
          : Object.freeze({
              version: lix.version,
              packageDigest: lix.packageDigest,
            }),
      }),
    }),
    validate: validator.validate,
    validatorPolicyFacts: validator.policyFacts,
  });

  process.stderr.write(
    validator.kind === "haxe-only"
      ? `genes watch: ${validator.label}; add --validator for host admission.\n`
      : `genes watch: validator module ${validator.label}.\n`,
  );

  let requestedExitCode: number | undefined;
  let closePromise: Promise<void> | undefined;
  let invalidResultClose: NodeJS.Immediate | undefined;
  let invalidResultShapeObserved = false;
  let finish: (() => void) | undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const requestClose = (exitCode: number): void => {
    requestedExitCode = selectWatchExitCode(requestedExitCode, exitCode);
    closePromise ??= session.close()
      .catch((error: unknown) => {
        requestedExitCode = 1;
        process.stderr.write(`genes watch: shutdown failed: ${errorText(error)}\n`);
      })
      .then(() => finish?.());
  };
  handleInvalidResultShape = () => {
    invalidResultShapeObserved = true;
    // Let the session publish its versioned failure event before closure.
    invalidResultClose ??= setImmediate(() => {
      invalidResultClose = undefined;
      requestClose(2);
    });
  };
  const output = new WatchOutputWriter(process.stdout, {
    maxPendingRecords: WATCH_OUTPUT_MAX_PENDING_RECORDS,
    maxPendingBytes: WATCH_OUTPUT_MAX_PENDING_BYTES,
    drainTimeoutMs: WATCH_OUTPUT_DRAIN_TIMEOUT_MS,
    onFailure: (failure) => {
      if (failure.exitCode !== 0) {
        process.stderr.write(`genes watch: ${failure.message}\n`);
      }
      requestClose(failure.exitCode);
    },
  });
  const onSigint = (): void => requestClose(130);
  const onSigterm = (): void => requestClose(143);
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  const unsubscribe = session.subscribe((event) => {
    try {
      if (options.jsonLines) {
        output.writeLine(JSON.stringify(event));
      } else {
        const line = formatWatchEvent(event);
        if (line !== null) output.writeLine(line);
      }
    } catch (error) {
      output.fail(error, "cannot serialize stdout record");
    }
    if (
      event.event.kind === "failed" &&
      !event.event.failure.recoverable
    ) {
      requestClose(1);
    }
    if (event.event.kind === "closed") finish?.();
  });
  void session.firstAccepted.catch(() => undefined);

  try {
    try {
      await session.start();
    } catch (error) {
      const exitCode = invalidResultShapeObserved ? 2 : 1;
      requestedExitCode = selectWatchExitCode(requestedExitCode, exitCode);
      process.stderr.write(`genes watch: startup failed: ${errorText(error)}\n`);
      requestClose(exitCode);
    }
    await finished;
    await closePromise;
    await output.finish();
    return requestedExitCode ?? 0;
  } finally {
    if (invalidResultClose !== undefined) clearImmediate(invalidResultClose);
    unsubscribe();
    output.dispose();
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}
