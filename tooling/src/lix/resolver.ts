import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

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
  return Object.freeze(
    readdirSync(directory, { withFileTypes: true })
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
    child.once("exit", (code, signal) => {
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
  const realClassPath = realpathSync.native(absolute);
  let current = realClassPath;
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
      return realpathSync.native(current);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  fail(
    "LIX_RESOLVER_UNSAFE_LIBRARY",
    `Lix haxelib class path has no containing haxelib.json: ${realClassPath}`,
  );
}

function parseOutput(stdout: string, projectRoot: string): {
  readonly arguments: readonly string[];
  readonly packageRoots: readonly string[];
  readonly packageManifests: readonly string[];
} {
  if (UNSAFE_TEXT.test(stdout)) {
    fail(
      "LIX_RESOLVER_MALFORMED_OUTPUT",
      "Lix haxelib output contains unsafe control text",
    );
  }
  const argumentsResult: string[] = [];
  const roots = new Set<string>();
  const manifests = new Set<string>();
  for (const raw of stdout.replaceAll("\r\n", "\n").split("\n")) {
    if (raw.length === 0) continue;
    if (raw !== raw.trim()) {
      fail(
        "LIX_RESOLVER_MALFORMED_OUTPUT",
        "Lix haxelib output has leading or trailing whitespace",
      );
    }
    const line = raw;
    if (line.startsWith("-")) {
      const separator = line.search(/\s/u);
      const option = separator === -1 ? line : line.slice(0, separator);
      const value = separator === -1 ? null : line.slice(separator).trimStart();
      if (value !== null && value.length === 0) {
        fail(
          "LIX_RESOLVER_MALFORMED_OUTPUT",
          `Lix haxelib option ${option} has no value`,
        );
      }
      if (CLASS_PATH_OPTIONS.has(option)) {
        if (value === null) {
          fail(
            "LIX_RESOLVER_MALFORMED_OUTPUT",
            `Lix haxelib option ${option} must contain one class path`,
          );
        }
        const classPath = path.resolve(projectRoot, value);
        const root = realPackageRoot(classPath);
        roots.add(root);
        manifests.add(path.join(root, "haxelib.json"));
        argumentsResult.push("-cp", realpathSync.native(classPath));
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
  for (const file of provenanceFiles) readFileSync(file);
  return Object.freeze({
    requests,
    allowedRoots: parsed.packageRoots,
    arguments: parsed.arguments,
    provenanceFiles,
  });
}
