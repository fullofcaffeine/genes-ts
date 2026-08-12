import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  type Dirent,
} from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

import { HAXE_4_3_7_OPTION_ARITY } from "../hxml/index.js";
import {
  LixLibraryResolverError,
  type LixLibraryResolverFailureCode,
  type ResolveLixLibraryGroupOptions,
  type ResolvedLixLibraryGroup,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const LIBRARY_NAME = /^[A-Za-z0-9_.-]+$/u;
const CLASS_PATH_OPTIONS = new Set(["-cp", "-p", "--class-path"]);
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const UNSAFE_TEXT = /[\u0000-\u0009\u000b-\u001f\u007f]/u;

function fail(
  code: LixLibraryResolverFailureCode,
  message: string,
): never {
  throw new LixLibraryResolverError(code, message);
}

function containedBy(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function canonicalProjectRoot(value: string): string {
  const absolute = path.resolve(value);
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(absolute);
  } catch {
    fail("LIX_RESOLVER_INVALID_OPTIONS", "projectRoot does not exist");
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    fail(
      "LIX_RESOLVER_INVALID_OPTIONS",
      "projectRoot must be a real directory, not a link",
    );
  }
  // macOS commonly exposes /tmp through /private/tmp. Canonicalizing the
  // caller's root is safe; links *inside* that root are still rejected below.
  return realpathSync.native(absolute);
}

function assertRealFile(root: string, candidate: string, label: string): string {
  const absolute = path.resolve(candidate);
  if (!containedBy(root, absolute)) {
    fail("LIX_RESOLVER_UNSAFE_SCOPE", `${label} escapes projectRoot`);
  }
  let current = root;
  for (const segment of path.relative(root, absolute).split(path.sep)) {
    if (segment.length === 0) continue;
    current = path.join(current, segment);
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(current);
    } catch {
      fail("LIX_RESOLVER_UNSAFE_SCOPE", `${label} is missing`);
    }
    if (stats.isSymbolicLink()) {
      fail(
        "LIX_RESOLVER_UNSAFE_SCOPE",
        `${label} passes through a symbolic link`,
      );
    }
  }
  if (!lstatSync(absolute).isFile()) {
    fail("LIX_RESOLVER_UNSAFE_SCOPE", `${label} is not a regular file`);
  }
  return realpathSync.native(absolute);
}

function scopeFiles(projectRoot: string): readonly string[] {
  const directory = path.join(projectRoot, "haxe_libraries");
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(directory);
  } catch {
    fail(
      "LIX_RESOLVER_UNSAFE_SCOPE",
      "Lix scope directory haxe_libraries is missing",
    );
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    fail(
      "LIX_RESOLVER_UNSAFE_SCOPE",
      "Lix scope directory haxe_libraries must be a real directory",
    );
  }
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    fail(
      "LIX_RESOLVER_UNSAFE_SCOPE",
      "Lix scope directory haxe_libraries cannot be read",
    );
  }
  return Object.freeze(
    entries
      .filter((entry) => entry.name.endsWith(".hxml"))
      .map((entry) => {
        if (!entry.isFile() || entry.isSymbolicLink()) {
          fail(
            "LIX_RESOLVER_UNSAFE_SCOPE",
            `Lix scope file ${entry.name} must be a real regular file`,
          );
        }
        return assertRealFile(
          projectRoot,
          path.join(directory, entry.name),
          `Lix scope file ${entry.name}`,
        );
      })
      .sort((left, right) => Buffer.from(left).compare(Buffer.from(right))),
  );
}

function validateRequests(
  options: ResolveLixLibraryGroupOptions,
  projectRoot: string,
  scopes: readonly string[],
): readonly string[] {
  if (options.requests.length === 0) {
    fail(
      "LIX_RESOLVER_INVALID_OPTIONS",
      "Lix library group must contain at least one request",
    );
  }
  const available = new Set(
    scopes.map((file) => path.basename(file, ".hxml")),
  );
  const requests = options.requests.map((request) => {
    if (
      !LIBRARY_NAME.test(request.name) ||
      request.name === "." ||
      request.name === ".." ||
      !(
        request.request === request.name ||
        request.request.startsWith(`${request.name}:`)
      ) ||
      request.request === `${request.name}:` ||
      UNSAFE_TEXT.test(request.request) ||
      request.request.trim() !== request.request
    ) {
      fail(
        "LIX_RESOLVER_INVALID_OPTIONS",
        `Lix library request ${JSON.stringify(request.request)} has an unsafe name`,
      );
    }
    let workingDirectory: string;
    try {
      workingDirectory = realpathSync.native(
        path.resolve(request.workingDirectory),
      );
    } catch {
      fail(
        "LIX_RESOLVER_INVALID_OPTIONS",
        `Lix library ${request.name} has a missing working directory`,
      );
    }
    if (
      !lstatSync(workingDirectory).isDirectory() ||
      !containedBy(projectRoot, workingDirectory)
    ) {
      fail(
        "LIX_RESOLVER_INVALID_OPTIONS",
        `Lix library ${request.name} has a working directory outside projectRoot`,
      );
    }
    if (!available.has(request.name)) {
      fail(
        "LIX_RESOLVER_UNSAFE_SCOPE",
        `Lix scope file for ${request.name} is missing`,
      );
    }
    return request.request;
  });
  return Object.freeze(requests);
}

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

async function runHaxelib(
  options: ResolveLixLibraryGroupOptions,
  projectRoot: string,
  requests: readonly string[],
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (
    options.command.executable.length === 0 ||
    UNSAFE_TEXT.test(options.command.executable) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes <= 0
  ) {
    fail(
      "LIX_RESOLVER_INVALID_OPTIONS",
      "Lix resolver command options are invalid",
    );
  }
  const argsPrefix = options.command.argsPrefix ?? [];
  if (argsPrefix.some((argument) => UNSAFE_TEXT.test(argument))) {
    fail(
      "LIX_RESOLVER_INVALID_OPTIONS",
      "Lix resolver arguments contain unsafe control text",
    );
  }
  if (options.signal?.aborted === true) {
    fail("LIX_RESOLVER_ABORTED", "Lix library resolution was cancelled");
  }

  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(
      options.command.executable,
      [...argsPrefix, "path", ...requests],
      {
        cwd: projectRoot,
        env: options.command.environment === undefined
          ? process.env
          : { ...options.command.environment },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let complete = false;

    const finish = (action: () => void): void => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      action();
    };
    const stopFor = (
      code: LixLibraryResolverFailureCode,
      message: string,
    ): void => {
      child.kill("SIGKILL");
      finish(() => reject(new LixLibraryResolverError(code, message)));
    };
    const abort = (): void => stopFor(
      "LIX_RESOLVER_ABORTED",
      "Lix library resolution was cancelled",
    );
    const timer = setTimeout(
      () => stopFor("LIX_RESOLVER_TIMEOUT", "Lix library resolution timed out"),
      timeoutMs,
    );
    options.signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      if (complete) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        stopFor(
          "LIX_RESOLVER_OUTPUT_TOO_LARGE",
          "Lix haxelib output exceeded the configured size limit",
        );
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (complete) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        stopFor(
          "LIX_RESOLVER_OUTPUT_TOO_LARGE",
          "Lix haxelib output exceeded the configured size limit",
        );
        return;
      }
      stderr.push(chunk);
    });
    child.once("error", (error) => {
      finish(() => reject(new LixLibraryResolverError(
        "LIX_RESOLVER_COMMAND_FAILED",
        `Cannot start the Lix haxelib command: ${error.message}`,
      )));
    });
    // `exit` can arrive while a child or grandchild still owns one of the
    // pipes. `close` means that Node has also received the final stdout and
    // stderr bytes, so a large library result cannot be parsed too early.
    child.once("close", (code, signal) => {
      if (complete) return;
      let stdoutText: string;
      let stderrText: string;
      try {
        stdoutText = UTF8.decode(Buffer.concat(stdout));
        stderrText = UTF8.decode(Buffer.concat(stderr));
      } catch {
        finish(() => reject(new LixLibraryResolverError(
          "LIX_RESOLVER_MALFORMED_OUTPUT",
          "Lix haxelib output is not valid UTF-8",
        )));
        return;
      }
      if (code !== 0) {
        finish(() => reject(new LixLibraryResolverError(
          "LIX_RESOLVER_COMMAND_FAILED",
          `Lix haxelib path failed with ${signal ?? `exit ${code ?? "unknown"}`}: ${stderrText.trim() || "no diagnostic"}`,
        )));
        return;
      }
      finish(() => resolve({ stdout: stdoutText, stderr: stderrText }));
    });
  });
}

function assertNoSymbolicLinkComponents(
  root: string,
  candidate: string,
  label: string,
): void {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(candidate);
  if (!containedBy(absoluteRoot, absolute)) {
    fail("LIX_RESOLVER_UNSAFE_LIBRARY", `${label} escapes its package root`);
  }
  let current = path.dirname(absoluteRoot);
  for (const segment of path.relative(current, absolute).split(path.sep)) {
    if (segment.length === 0) continue;
    current = path.join(current, segment);
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(current);
    } catch {
      fail("LIX_RESOLVER_UNSAFE_LIBRARY", `${label} is missing: ${current}`);
    }
    if (stats.isSymbolicLink()) {
      fail(
        "LIX_RESOLVER_UNSAFE_LIBRARY",
        `${label} passes through a symbolic link: ${current}`,
      );
    }
  }
}

function realPackageRoot(classPath: string): string {
  const absolute = path.resolve(classPath);
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(absolute);
  } catch {
    fail(
      "LIX_RESOLVER_UNSAFE_LIBRARY",
      `Lix haxelib returned a missing class path: ${absolute}`,
    );
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    fail(
      "LIX_RESOLVER_UNSAFE_LIBRARY",
      `Lix haxelib class path must be a real directory: ${absolute}`,
    );
  }
  let current = absolute;
  for (let depth = 0; depth < 64; depth += 1) {
    const manifest = path.join(current, "haxelib.json");
    if (existsSync(manifest)) {
      const manifestStats = lstatSync(manifest);
      if (manifestStats.isSymbolicLink() || !manifestStats.isFile()) {
        fail(
          "LIX_RESOLVER_UNSAFE_LIBRARY",
          `Lix package manifest must be a real file: ${manifest}`,
        );
      }
      assertNoSymbolicLinkComponents(
        current,
        absolute,
        "Lix haxelib class path",
      );
      return realpathSync.native(current);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  fail(
    "LIX_RESOLVER_UNSAFE_LIBRARY",
    `Lix haxelib class path has no containing haxelib.json: ${absolute}`,
  );
}

/** Mirrors Haxe 4.3.7 HXML quoting without applying shell rules. */
function haxeUnquote(value: string): string {
  if (value.length === 0) return value;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' && last === '"') ||
    (first === "'" && last === "'")
    ? value.slice(1, -1)
    : value;
}

function parseOutput(stdout: string, projectRoot: string): {
  readonly arguments: readonly string[];
  readonly packageRoots: readonly string[];
  readonly packageManifests: readonly string[];
} {
  // Windows commands use CRLF. Remove the CR only when it is part of that
  // line ending, then reject every remaining control character as before.
  const normalizedOutput = stdout.replaceAll("\r\n", "\n");
  if (UNSAFE_TEXT.test(normalizedOutput)) {
    fail(
      "LIX_RESOLVER_MALFORMED_OUTPUT",
      "Lix haxelib output contains unsafe control text",
    );
  }
  const argumentsResult: string[] = [];
  const roots = new Set<string>();
  const manifests = new Set<string>();
  const lines = normalizedOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = haxeUnquote(lines[lineIndex]!);
    if (!line.startsWith("-") && line.endsWith(".hxml")) {
      const hxml = path.resolve(projectRoot, line);
      let hxmlStats: ReturnType<typeof lstatSync>;
      try {
        hxmlStats = lstatSync(hxml);
      } catch {
        fail(
          "LIX_RESOLVER_UNSAFE_LIBRARY",
          `Lix haxelib returned a missing HXML file: ${hxml}`,
        );
      }
      if (hxmlStats.isSymbolicLink() || !hxmlStats.isFile()) {
        fail(
          "LIX_RESOLVER_UNSAFE_LIBRARY",
          `Lix haxelib HXML path must be a real file: ${hxml}`,
        );
      }
      if (containedBy(projectRoot, hxml)) {
        assertNoSymbolicLinkComponents(
          projectRoot,
          hxml,
          "Lix haxelib HXML file",
        );
      } else {
        const root = realPackageRoot(path.dirname(hxml));
        roots.add(root);
        manifests.add(path.join(root, "haxelib.json"));
      }
      argumentsResult.push(realpathSync.native(hxml));
      continue;
    }
    if (line.startsWith("-")) {
      const whitespace = line.search(/\s/u);
      const equals = line.indexOf("=");
      const possibleInlineOption =
        equals > 0 && (whitespace === -1 || equals < whitespace)
          ? line.slice(0, equals)
          : null;
      const hasInlineClassPath =
        possibleInlineOption !== null &&
        CLASS_PATH_OPTIONS.has(possibleInlineOption);
      const option = hasInlineClassPath
        ? possibleInlineOption
        : whitespace === -1
          ? line
          : line.slice(0, whitespace);
      const rawValue = hasInlineClassPath
        ? line.slice(equals + 1)
        : whitespace === -1
          ? null
          : line.slice(whitespace).trimStart();
      let value = rawValue === null ? null : haxeUnquote(rawValue);
      if (value === null && HAXE_4_3_7_OPTION_ARITY[option] === 1) {
        const nextLine = lines[lineIndex + 1];
        if (nextLine !== undefined) {
          value = haxeUnquote(nextLine);
          lineIndex += 1;
        }
      }
      if (value !== null && value.length === 0) {
        fail(
          "LIX_RESOLVER_MALFORMED_OUTPUT",
          `Lix haxelib option ${option} has no value`,
        );
      }
      if (CLASS_PATH_OPTIONS.has(option) || option === "-L") {
        if (value === null) {
          fail(
            "LIX_RESOLVER_MALFORMED_OUTPUT",
            `Lix haxelib option ${option} must contain one path`,
          );
        }
        const libraryPath = path.resolve(projectRoot, value);
        const root = realPackageRoot(libraryPath);
        roots.add(root);
        manifests.add(path.join(root, "haxelib.json"));
        argumentsResult.push(
          option === "-L" ? "--neko-lib-path" : "-cp",
          realpathSync.native(libraryPath),
        );
      } else {
        argumentsResult.push(option);
        if (value !== null) argumentsResult.push(value);
      }
      continue;
    }
    const classPath = path.resolve(projectRoot, line);
    const root = realPackageRoot(classPath);
    roots.add(root);
    manifests.add(path.join(root, "haxelib.json"));
    argumentsResult.push("-cp", realpathSync.native(classPath));
  }
  return Object.freeze({
    arguments: Object.freeze(argumentsResult),
    packageRoots: Object.freeze(
      [...roots].sort((left, right) =>
        Buffer.from(left).compare(Buffer.from(right)),
      ),
    ),
    packageManifests: Object.freeze(
      [...manifests].sort((left, right) =>
        Buffer.from(left).compare(Buffer.from(right)),
      ),
    ),
  });
}

/**
 * Resolves one Haxe library group through a Lix-owned `haxelib` shim.
 *
 * Why: Haxe sends adjacent `-lib` values to one `haxelib path` call. Repeating
 * the call once per library can change dependency order. Every Lix host would
 * otherwise need its own parser and watch policy.
 *
 * What: the function checks the project scope, runs one exact command without
 * a shell, converts path lines to explicit `-cp` arguments, and returns the
 * package roots and proof files needed by Genes HXML inventory.
 *
 * How: Lix's authored `haxe_libraries/*.hxml` files prove the selected scope.
 * A real `haxelib.json` above each returned class path proves the external
 * package root. The caller must discard this snapshot when its lockfile,
 * scope, command identity, or requested group changes.
 */
export async function resolveLixLibraryGroup(
  options: ResolveLixLibraryGroupOptions,
): Promise<ResolvedLixLibraryGroup> {
  const projectRoot = canonicalProjectRoot(options.projectRoot);
  const scopes = scopeFiles(projectRoot);
  const requests = validateRequests(options, projectRoot, scopes);
  const command = await runHaxelib(options, projectRoot, requests);
  const parsed = parseOutput(command.stdout, projectRoot);
  const provenanceFiles = Object.freeze(
    [...new Set([...scopes, ...parsed.packageManifests])].sort((left, right) =>
      Buffer.from(left).compare(Buffer.from(right)),
    ),
  );
  // Reading each proof byte here makes unreadable scope or package evidence a
  // resolver failure instead of a later watcher surprise.
  const scopeSet = new Set(scopes);
  for (const file of provenanceFiles) {
    try {
      readFileSync(file);
    } catch {
      const scope = scopeSet.has(file);
      fail(
        scope ? "LIX_RESOLVER_UNSAFE_SCOPE" : "LIX_RESOLVER_UNSAFE_LIBRARY",
        `${scope ? "Lix scope file" : "Lix package manifest"} cannot be read after resolution: ${file}`,
      );
    }
  }
  return Object.freeze({
    requests,
    allowedRoots: parsed.packageRoots,
    arguments: parsed.arguments,
    provenanceFiles,
  });
}
