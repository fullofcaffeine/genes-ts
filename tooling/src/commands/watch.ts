import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  createGenesDevelopmentSession,
  type AdmissionResult,
  type DevelopmentEvent,
  type JsonValue,
  type ValidationTree,
} from "../session/index.js";
import { resolveLixLibraryGroup } from "../lix/index.js";

const WATCH_VALIDATION_PROTOCOL = "genes.tooling.watch-validation" as const;
const WATCH_VALIDATION_VERSION = 1 as const;
const WATCH_VALIDATOR_RESULT_INVALID =
  "GENES_WATCH_VALIDATOR_RESULT_INVALID" as const;
const HAXE_VERSION = "4.3.7" as const;

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
  --hxml <file>           Ordered top-level HXML file. Repeat to add an entry.
  --output <file>         Project-relative public Genes entry file.

Options:
  --root <directory>      Project root. Default: current working directory.
  --state <directory>     Private session state. Default: .genes/dev.
  --allow-root <path>     Additional trusted HXML or source root. Repeatable.
  --haxe <executable>     Haxe 4.3.7 executable. Default: haxe.
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
        hxmlFiles.push(takeValue(args, index, argument));
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

function jsonRecord(
  value: JsonValue | undefined,
): { readonly [key: string]: JsonValue } | undefined {
  return value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as { readonly [key: string]: JsonValue })
    : undefined;
}

function isInvalidValidatorResult(event: DevelopmentEvent<JsonValue>): boolean {
  if (
    event.event.kind !== "failed" ||
    event.event.failure.phase !== "validate"
  ) {
    return false;
  }
  const failure = jsonRecord(event.event.failure.diagnostic);
  const details = jsonRecord(failure?.["details"]);
  return (
    details?.["protocol"] === WATCH_VALIDATION_PROTOCOL &&
    details["version"] === WATCH_VALIDATION_VERSION &&
    details["code"] === WATCH_VALIDATOR_RESULT_INVALID
  );
}

function portableRelative(root: string, file: string): string {
  const relative = path.relative(root, file);
  return relative.split(path.sep).join("/");
}

export async function loadWatchValidator(
  projectRoot: string,
  modulePath?: string,
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

function probeHaxe(
  executable: string,
  projectRoot: string,
  environment: Readonly<Record<string, string>>,
): string {
  const probe = spawnSync(executable, ["--version"], {
    cwd: projectRoot,
    env: environment,
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
    windowsHide: true,
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
  const version = probeHaxe(selected, projectRoot, environment);
  if (version !== HAXE_VERSION) {
    throw new WatchCommandUsageError(
      `genes watch requires Haxe ${HAXE_VERSION}; ${executable} reported ${version || "no version"}.`,
    );
  }
  const managedCandidate = environment.HAXE_STD_PATH === undefined
    ? path.join(
        homedir(),
        "haxe",
        "versions",
        version,
        process.platform === "win32" ? "haxe.exe" : "haxe",
      )
    : path.join(
        path.dirname(environment.HAXE_STD_PATH),
        process.platform === "win32" ? "haxe.exe" : "haxe",
      );
  let nativeExecutable = selected;
  const launcherSelected = /\.(?:[cm]?js|cmd|bat)$/iu.test(selected);
  if (launcherSelected) {
    try {
      const canonicalManaged = realpathSync.native(managedCandidate);
      accessSync(canonicalManaged, constants.X_OK);
      if (probeHaxe(canonicalManaged, projectRoot, environment) === version) {
        nativeExecutable = canonicalManaged;
      }
    } catch {
      // A normal native Haxe installation does not need the Lix version layout.
    }
  }
  if (/\.(?:[cm]?js|cmd|bat)$/iu.test(nativeExecutable)) {
    throw new WatchCommandUsageError(
      "genes watch resolved a Haxe launcher instead of the native compiler; use --haxe with the native Haxe 4.3.7 executable.",
    );
  }
  return Object.freeze({ executable: nativeExecutable, version, environment });
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

export async function runWatchCommand(
  options: WatchCommandOptions,
): Promise<number> {
  const projectRoot = realpathSync.native(options.projectRoot);
  const haxe = checkHaxe(options.haxeExecutable, projectRoot);
  const lix = options.useLix ? loadLix(projectRoot) : undefined;
  const validator = await loadWatchValidator(
    projectRoot,
    options.validatorModule,
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
  let outputOpen = true;
  const onStdoutError = (error: Error): void => {
    outputOpen = false;
    const exitCode = watchOutputErrorExitCode(error);
    if (exitCode !== 0) {
      process.stderr.write(`genes watch: stdout failed: ${errorText(error)}\n`);
    }
    requestClose(exitCode);
  };
  const onSigint = (): void => requestClose(130);
  const onSigterm = (): void => requestClose(143);
  process.stdout.on("error", onStdoutError);
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  const unsubscribe = session.subscribe((event) => {
    if (outputOpen) {
      if (options.jsonLines) {
        process.stdout.write(`${JSON.stringify(event)}\n`);
      } else {
        const line = formatWatchEvent(event);
        if (line !== null) process.stdout.write(`${line}\n`);
      }
    }
    if (isInvalidValidatorResult(event)) {
      requestClose(2);
    } else if (
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
      requestedExitCode = 1;
      process.stderr.write(`genes watch: startup failed: ${errorText(error)}\n`);
      requestClose(1);
    }
    await finished;
    await closePromise;
    return requestedExitCode ?? 0;
  } finally {
    unsubscribe();
    process.stdout.removeListener("error", onStdoutError);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}
