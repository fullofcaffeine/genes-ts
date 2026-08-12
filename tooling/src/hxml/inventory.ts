import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import {
  HxmlInventoryError,
  type HxmlFailureKind,
  type HxmlInventory,
  type HxmlInventoryOptions,
  type HxmlLibrary,
  type HxmlLibraryResolution,
  type HxmlLibraryRequest,
  type HxmlOccurrence,
} from "./types.js";

const DEFAULT_MAX_HXML_FILES = 1_000;
const DEFAULT_MAX_HXML_OCCURRENCES = 1_000;
const DEFAULT_MAX_ARGUMENTS = 100_000;

/** Exact public option spellings and arities from Haxe 4.3.7 Args. */
export const HAXE_4_3_7_OPTION_ARITY: Readonly<Record<string, 0 | 1>> =
  Object.freeze({
    "--js": 1,
    "-js": 1,
    "--lua": 1,
    "-lua": 1,
    "--swf": 1,
    "-swf": 1,
    "--neko": 1,
    "-neko": 1,
    "--php": 1,
    "-php": 1,
    "--cpp": 1,
    "-cpp": 1,
    "--cppia": 1,
    "-cppia": 1,
    "--cs": 1,
    "-cs": 1,
    "--java": 1,
    "-java": 1,
    "--jvm": 1,
    "--python": 1,
    "-python": 1,
    "--hl": 1,
    "-hl": 1,
    "-x": 1,
    "--interp": 0,
    // Haxe's normal option table declares `--run` without a value. A separate
    // compiler pass consumes the following module name before this table runs.
    "--run": 0,
    "-p": 1,
    "--class-path": 1,
    "-cp": 1,
    "-m": 1,
    "--main": 1,
    "-main": 1,
    "-L": 1,
    "--library": 1,
    "-lib": 1,
    "-D": 1,
    "--define": 1,
    "-v": 0,
    "--verbose": 0,
    "--debug": 0,
    "-debug": 0,
    "--version": 0,
    "-version": 0,
    "-h": 0,
    "--help": 0,
    "-help": 0,
    "--help-defines": 0,
    "--help-user-defines": 0,
    "--help-metas": 0,
    "--help-user-metas": 0,
    "--dce": 1,
    "-dce": 1,
    "--swf-version": 1,
    "-swf-version": 1,
    "--swf-header": 1,
    "-swf-header": 1,
    "--flash-strict": 0,
    "--swf-lib": 1,
    "-swf-lib": 1,
    "--neko-lib-path": 1,
    "--swf-lib-extern": 1,
    "-swf-lib-extern": 1,
    "--java-lib": 1,
    "-java-lib": 1,
    "--java-lib-extern": 1,
    "--net-lib": 1,
    "-net-lib": 1,
    "--net-std": 1,
    "-net-std": 1,
    "--c-arg": 1,
    "-c-arg": 1,
    "-r": 1,
    "--resource": 1,
    "-resource": 1,
    "--prompt": 0,
    "-prompt": 0,
    "--cmd": 1,
    "-cmd": 1,
    "--no-traces": 0,
    "--next": 0,
    "--each": 0,
    "--display": 1,
    "--xml": 1,
    "-xml": 1,
    "--json": 1,
    "--no-output": 0,
    "--times": 0,
    "--no-inline": 0,
    "--no-opt": 0,
    "--remap": 1,
    "--macro": 1,
    "--server-listen": 1,
    "--wait": 1,
    "--server-connect": 1,
    "--connect": 1,
    "-C": 1,
    "--cwd": 1,
    "--haxelib-global": 0,
    "-w": 1,
  });

/**
 * Haxe 4.3.7 handles these options before, or outside, its ordinary option
 * table. Their `--option=value` spelling is therefore not interchangeable
 * with the documented separate-value spelling: some fail, while others are
 * ignored instead of doing what the author requested. Rejecting every
 * inline form keeps inventory from inventing an effective Haxe invocation.
 */
export const HAXE_4_3_7_EARLY_INLINE_OPTIONS: ReadonlySet<string> =
  new Set([
    "-C",
    "--cwd",
    "--connect",
    "--server-connect",
    "--server-listen",
    "--wait",
    "--run",
    "-L",
    "--library",
    "-lib",
    "--jvm",
    "--java",
    "-java",
    "--cs",
    "-cs",
    "--display",
  ]);

/** Internal Haxe 4.3.7 spelling check shared with the session binder. */
export function isHaxe437OrdinaryInlineHxmlOption(argument: string): boolean {
  const equals = argument.indexOf("=");
  if (equals <= 0 || !argument.endsWith(".hxml")) return false;
  const option = argument.slice(0, equals);
  return (
    HAXE_4_3_7_OPTION_ARITY[option] === 1 &&
    !HAXE_4_3_7_EARLY_INLINE_OPTIONS.has(option)
  );
}

function fail(kind: HxmlFailureKind, subject: string): never {
  throw new HxmlInventoryError(Object.freeze({ kind, subject }));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    fail("resolver-failure", "inventory-aborted");
  }
}

async function awaitWithAbort<Value>(
  value: Value | Promise<Value>,
  signal: AbortSignal | undefined,
): Promise<Value> {
  if (signal === undefined) return await value;
  throwIfAborted(signal);
  return await new Promise<Value>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void =>
      finish(() =>
        reject(
          new HxmlInventoryError(
            Object.freeze({
              kind: "resolver-failure",
              subject: "inventory-aborted",
            }),
          ),
        ),
      );
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(value).then(
      (resolved) => finish(() => resolve(resolved)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function bytewise(values: Iterable<string>): string[] {
  return [...values].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );
}

function canonicalDirectory(candidate: string, subject: string): string {
  let canonical: string;
  try {
    canonical = realpathSync.native(path.resolve(candidate));
  } catch {
    fail("missing-input", subject);
  }
  if (!lstatSync(canonical).isDirectory()) {
    fail("unsafe-input", subject);
  }
  return canonical;
}

function canonicalFile(candidate: string, subject: string): string {
  const absolute = path.resolve(candidate);
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(absolute);
  } catch {
    fail("missing-input", subject);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    fail("unsafe-input", subject);
  }
  return realpathSync.native(absolute);
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

function assertAllowed(
  roots: readonly string[],
  candidate: string,
  subject: string,
): void {
  if (!roots.some((root) => containedBy(root, candidate))) {
    fail("unsafe-input", subject);
  }
}

function assertNoSymlinkComponents(
  roots: readonly string[],
  candidate: string,
  subject: string,
): void {
  const absolute = path.resolve(candidate);
  const root = roots.find((allowed) => containedBy(allowed, absolute));
  if (root === undefined) {
    fail("unsafe-input", subject);
  }
  let current = root;
  const relative = path.relative(root, absolute);
  for (const segment of relative
    .split(path.sep)
    .filter((value) => value.length > 0)) {
    current = path.join(current, segment);
    // `existsSync` also returns false for a broken symbolic link. `lstat`
    // lets us tell that unsafe link apart from a path that truly does not
    // exist yet, which is important for generated class-path directories.
    const status = lstatSync(current, { throwIfNoEntry: false });
    if (status === undefined) {
      return;
    }
    if (status.isSymbolicLink()) {
      fail("unsafe-input", subject);
    }
  }
}

function haxeUnquote(value: string): string {
  if (value.length === 0) return value;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'")
    ? value.slice(1, -1)
    : value;
}

/** Mirrors Haxe 4.3.7 Helper.parse_hxml_data, not shell tokenization. */
function argumentsFromLine(line: string): readonly string[] {
  const value = haxeUnquote(line.trim());
  if (value.length === 0 || value.startsWith("#")) return Object.freeze([]);
  if (!value.startsWith("-")) return Object.freeze([value]);
  const separator = value.indexOf(" ");
  if (separator === -1) return Object.freeze([value]);
  return Object.freeze([
    haxeUnquote(value.slice(0, separator)),
    haxeUnquote(value.slice(separator + 1).trim()),
  ]);
}

function argumentsFromFile(file: string): readonly string[] {
  return Object.freeze(
    readFileSync(file, "utf8")
      .split(/[\r\n]+/u)
      .flatMap((line) => argumentsFromLine(line)),
  );
}

function expanded(
  value: string,
  environment: ((name: string) => string | null) | undefined,
): string {
  return value.replace(
    /%([A-Za-z0-9_]+)%/gu,
    (_match, name: string) => {
      const replacement = environment?.(name) ?? null;
      return replacement ?? `%${name}%`;
    },
  );
}

function libraryRequest(
  request: string,
  fromFile: string,
  workingDirectory: string,
): HxmlLibraryRequest {
  const separator = request.lastIndexOf(":");
  const name = separator === -1 ? request : request.slice(0, separator);
  const version = separator === -1 ? null : request.slice(separator + 1);
  if (
    !/^[A-Za-z0-9_.-]+$/u.test(name) ||
    (version !== null && version.length === 0)
  ) {
    fail("invalid-syntax", `${fromFile}:library:${request}`);
  }
  return Object.freeze({
    request,
    name,
    version,
    fromFile,
    workingDirectory,
  });
}

async function inventoryHxmlWithPolicy(
  options: HxmlInventoryOptions,
  allowInlineHxmlOptionValues: boolean,
): Promise<HxmlInventory> {
  throwIfAborted(options.signal);
  const maxHxmlFiles = options.maxHxmlFiles ?? DEFAULT_MAX_HXML_FILES;
  const maxHxmlOccurrences =
    options.maxHxmlOccurrences ?? DEFAULT_MAX_HXML_OCCURRENCES;
  const maxArguments = options.maxArguments ?? DEFAULT_MAX_ARGUMENTS;
  if (
    options.entryFiles.length === 0 ||
    !Number.isInteger(maxHxmlFiles) ||
    maxHxmlFiles <= 0 ||
    !Number.isInteger(maxHxmlOccurrences) ||
    maxHxmlOccurrences <= 0 ||
    !Number.isInteger(maxArguments) ||
    maxArguments <= 0
  ) {
    fail("invalid-option", "inventory limits and entry files");
  }
  const workingDirectory = canonicalDirectory(
    options.workingDirectory,
    "workingDirectory",
  );
  const allowedRootSet = new Set(
    options.allowedRoots.map((root, index) =>
      canonicalDirectory(root, `allowedRoots[${index}]`),
    ),
  );
  let allowedRoots = Object.freeze(
    bytewise(
      allowedRootSet,
    ),
  );
  if (allowedRoots.length === 0) {
    fail("invalid-option", "allowedRoots");
  }
  if (
    options.resolveLibrary !== undefined &&
    options.resolveLibraries !== undefined
  ) {
    fail("invalid-option", "resolveLibrary and resolveLibraries are exclusive");
  }

  const hxmlFiles = new Set<string>();
  const libraryProvenanceFiles = new Set<string>();
  const activeHxmlOccurrences = new Set<string>();
  const orderedHxmlOccurrences: HxmlOccurrence[] = [];
  const entryHxmlFiles: string[] = [];
  const classPaths = new Set<string>();
  const resources = new Set<string>();
  const libraries: HxmlLibrary[] = [];
  const recordedLibraryMetadata = new Set<string>();
  let legacyResolvedLibrary: string | null = null;
  const pendingLibraries: {
    readonly option: string;
    readonly request: HxmlLibraryRequest;
  }[] = [];
  const effectiveArguments: string[] = [];
  let libraryClosureComplete = true;
  let argumentCount = 0;
  const resolverSignal = options.signal ?? new AbortController().signal;

  const highLevelOptions = new Set([
    "-C",
    "--cwd",
    "-L",
    "-lib",
    "--library",
  ]);
  const libraryOptions = new Set(["-L", "-lib", "--library"]);
  const classPathOptions = new Set(["-p", "-cp", "--class-path"]);
  const resourceOptions = new Set(["-r", "-resource", "--resource"]);

  let flushLibraries: () => Promise<void>;

  const processArguments = async (
    args: readonly string[],
    sourceFile: string,
    cwd: string,
  ): Promise<void> => {
    argumentCount += args.length;
    if (argumentCount > maxArguments) fail("budget-exceeded", "arguments");
    for (let index = 0; index < args.length; index += 1) {
      throwIfAborted(options.signal);
      const rawArgument = args[index]!;
      const expandedArgument = expanded(rawArgument, options.environment);
      if (/[\0\r\n]/u.test(expandedArgument)) {
        fail("invalid-syntax", `${sourceFile}:argument-control-character`);
      }
      const equals = expandedArgument.indexOf("=");
      const possibleOption = equals > 0
        ? expandedArgument.slice(0, equals)
        : expandedArgument;
      if (
        equals > 0 &&
        HAXE_4_3_7_EARLY_INLINE_OPTIONS.has(possibleOption)
      ) {
        fail(
          "invalid-syntax",
          `${sourceFile}:${possibleOption}:early-inline-unsupported-v1`,
        );
      }
      const hasInlineValue =
        equals > 0 && HAXE_4_3_7_OPTION_ARITY[possibleOption] === 1;
      const argument = hasInlineValue ? possibleOption : expandedArgument;
      const inlineValue = hasInlineValue
        ? expandedArgument.slice(equals + 1)
        : undefined;
      if (
        rawArgument !== expandedArgument &&
        (highLevelOptions.has(argument) ||
          (!argument.startsWith("-") && argument.endsWith(".hxml")))
      ) {
        fail("invalid-syntax", `${sourceFile}:stage-changing-environment`);
      }

      if (!rawArgument.startsWith("-") && rawArgument.endsWith(".hxml")) {
        const nested = path.resolve(cwd, rawArgument);
        await collect(nested, cwd, `${sourceFile}:nested:${rawArgument}`);
        continue;
      }

      if (!hasInlineValue && expandedArgument.endsWith(".hxml")) {
        fail(
          "invalid-syntax",
          `${sourceFile}:residual-hxml-token:${expandedArgument}`,
        );
      }

      if (!argument.startsWith("-")) {
        await flushLibraries();
        effectiveArguments.push(argument);
        continue;
      }

      const forbiddenOptions = options.argumentPolicy?.forbiddenOptions ?? [];
      if (forbiddenOptions.includes(argument)) {
        fail("invalid-option", `${sourceFile}:${argument}`);
      }
      const arity = HAXE_4_3_7_OPTION_ARITY[argument];
      if (arity === undefined) {
        if (options.argumentPolicy?.rejectUnknownOptions === true) {
          fail("invalid-option", `${sourceFile}:unknown:${argument}`);
        }
        await flushLibraries();
        effectiveArguments.push(argument);
        continue;
      }
      const consumesNextArgument = arity === 1 && inlineValue === undefined;
      const rawValue = inlineValue ?? (consumesNextArgument
        ? args[index + 1]
        : undefined);
      if (arity === 1 && rawValue === undefined) {
        fail("invalid-syntax", `${sourceFile}:${argument}:missing-value`);
      }
      const value = inlineValue !== undefined
        ? inlineValue
        : rawValue === undefined
          ? undefined
          : expanded(rawValue, options.environment);

      // The loop validates the option token above, but an option with a
      // separate value skips that value on the next iteration. Check the
      // expanded value here so an environment variable cannot add another
      // HXML line or a NUL byte behind the option's back.
      if (value !== undefined && /[\0\r\n]/u.test(value)) {
        fail(
          "invalid-syntax",
          `${sourceFile}:${argument}:value-control-character`,
        );
      }

      if (rawValue !== value && libraryOptions.has(argument)) {
        fail("invalid-syntax", `${sourceFile}:stage-changing-environment`);
      }

      if (
        value?.endsWith(".hxml") === true &&
        (inlineValue === undefined || !allowInlineHxmlOptionValues) &&
        !(libraryOptions.has(argument) && inlineValue === undefined)
      ) {
        fail(
          "invalid-syntax",
          `${sourceFile}:${argument}:residual-hxml-token`,
        );
      }

      if (libraryOptions.has(argument)) {
        const request = libraryRequest(value!, sourceFile, cwd);
        pendingLibraries.push(Object.freeze({ option: argument, request }));
        if (consumesNextArgument) index += 1;
        continue;
      }

      await flushLibraries();

      if (argument === "-C" || argument === "--cwd") {
        fail("invalid-option", `${sourceFile}:${argument}:unsupported-v1`);
      }
      if (resourceOptions.has(argument)) {
        fail("invalid-option", `${sourceFile}:${argument}:unsupported-v1`);
      }

      if (argument === "-D" || argument === "--define") {
        const defineName = value!.split("=", 1)[0]!;
        if (
          (options.argumentPolicy?.forbiddenDefines ?? []).includes(defineName)
        ) {
          fail("invalid-option", `${sourceFile}:define:${defineName}`);
        }
      }

      if (classPathOptions.has(argument)) {
        const resolved = path.resolve(cwd, value!);
        assertAllowed(allowedRoots, resolved, `${sourceFile}:classPath`);
        assertNoSymlinkComponents(
          allowedRoots,
          resolved,
          `${sourceFile}:classPath`,
        );
        if (existsSync(resolved)) {
          classPaths.add(
            canonicalDirectory(resolved, `${sourceFile}:classPath`),
          );
        } else {
          // Keep a not-yet-created class path in the inventory. The first Haxe
          // compile may fail, but the reconciled watcher can observe the new
          // directory and let the session recover on the next build.
          if (/%[A-Za-z0-9_]+%/u.test(value!)) {
            fail("missing-input", `${sourceFile}:classPath`);
          }
          classPaths.add(resolved);
        }
      }

      if (inlineValue !== undefined && value?.endsWith(".hxml") === true) {
        // Haxe expands standalone `*.hxml` arguments before it splits an
        // ordinary `--option=value` token. Preserve this spelling so a value
        // such as `--define=config=build.hxml` stays data instead of becoming
        // another HXML file when the flattened command runs.
        effectiveArguments.push(`${argument}=${value}`);
      } else {
        effectiveArguments.push(argument);
        if (value !== undefined) effectiveArguments.push(value);
      }
      if (consumesNextArgument) index += 1;
    }
  };

  flushLibraries = async (): Promise<void> => {
    if (pendingLibraries.length === 0) return;
    const batch = pendingLibraries.splice(0, pendingLibraries.length);
    const requests = Object.freeze(batch.map((entry) => entry.request));
    for (const request of requests) {
      if (recordedLibraryMetadata.has(request.request)) continue;
      recordedLibraryMetadata.add(request.request);
      libraries.push(
        Object.freeze({
          request: request.request,
          name: request.name,
          version: request.version,
          fromFile: request.fromFile,
          workingDirectory: request.workingDirectory,
        }),
      );
    }

    if (
      options.resolveLibrary === undefined &&
      options.resolveLibraries === undefined
    ) {
      libraryClosureComplete = false;
      for (const entry of batch) {
        effectiveArguments.push(entry.option, entry.request.request);
      }
      return;
    }

    let resolution: HxmlLibraryResolution;
    const subject = `${requests[0]!.fromFile}:libraries:${requests
      .map((request) => request.request)
      .join(",")}`;
    try {
      if (options.resolveLibraries !== undefined) {
        resolution = await awaitWithAbort(
          options.resolveLibraries(requests, {
            signal: resolverSignal,
            environment: (name) => options.environment?.(name) ?? null,
          }),
          options.signal,
        );
      } else {
        const distinct = [...new Set(requests.map((request) => request.request))];
        const requested = distinct[0]!;
        if (
          distinct.length > 1 ||
          (legacyResolvedLibrary !== null && legacyResolvedLibrary !== requested)
        ) {
          fail(
            "invalid-syntax",
            `${requests[0]!.fromFile}:multiple-distinct-libraries-require-batch-resolver`,
          );
        }
        if (legacyResolvedLibrary === requested) return;
        legacyResolvedLibrary = requested;
        resolution = await awaitWithAbort(
          options.resolveLibrary!(requests[0]!, {
            signal: resolverSignal,
            environment: (name) => options.environment?.(name) ?? null,
          }),
          options.signal,
        );
      }
    } catch (error) {
      if (error instanceof HxmlInventoryError) throw error;
      fail("resolver-failure", subject);
    }

    for (const [rootIndex, candidate] of (
      resolution.allowedRoots ?? []
    ).entries()) {
      if (!path.isAbsolute(candidate)) {
        fail("resolver-failure", `${subject}:allowedRoots[${rootIndex}]`);
      }
      allowedRootSet.add(
        canonicalDirectory(candidate, `${subject}:allowedRoots[${rootIndex}]`),
      );
    }
    allowedRoots = Object.freeze(bytewise(allowedRootSet));

    for (const [fileIndex, candidate] of resolution.provenanceFiles.entries()) {
      if (!path.isAbsolute(candidate)) {
        fail("resolver-failure", `${subject}:provenance[${fileIndex}]`);
      }
      assertNoSymlinkComponents(
        allowedRoots,
        candidate,
        `${subject}:provenance[${fileIndex}]`,
      );
      const canonical = canonicalFile(
        candidate,
        `${subject}:provenance[${fileIndex}]`,
      );
      assertAllowed(
        allowedRoots,
        canonical,
        `${subject}:provenance[${fileIndex}]`,
      );
      libraryProvenanceFiles.add(canonical);
    }
    await processArguments(
      Object.freeze([...resolution.arguments]),
      subject,
      requests[0]!.workingDirectory,
    );
    await flushLibraries();
  };

  const collect = async (
    candidate: string,
    initialDirectory: string,
    subject: string,
  ): Promise<string> => {
    throwIfAborted(options.signal);
    assertNoSymlinkComponents(allowedRoots, candidate, subject);
    const file = canonicalFile(candidate, subject);
    assertAllowed(allowedRoots, file, subject);
    const initialCwd = canonicalDirectory(initialDirectory, `${subject}:cwd`);
    const occurrence = `${file}\0${initialCwd}`;
    if (activeHxmlOccurrences.has(occurrence)) {
      fail("invalid-syntax", `${subject}:hxml-cycle:${file}`);
    }
    orderedHxmlOccurrences.push(
      Object.freeze({ file, workingDirectory: initialCwd }),
    );
    if (orderedHxmlOccurrences.length > maxHxmlOccurrences) {
      fail("budget-exceeded", "hxmlOccurrences");
    }
    hxmlFiles.add(file);
    if (hxmlFiles.size > maxHxmlFiles) {
      fail("budget-exceeded", "hxmlFiles");
    }
    activeHxmlOccurrences.add(occurrence);
    try {
      await processArguments(argumentsFromFile(file), file, initialCwd);
    } finally {
      activeHxmlOccurrences.delete(occurrence);
    }
    return file;
  };

  for (const [index, entry] of options.entryFiles.entries()) {
    const candidate = path.resolve(workingDirectory, entry);
    const canonicalEntry = await collect(
      candidate,
      workingDirectory,
      `entryFiles[${index}]`,
    );
    entryHxmlFiles.push(canonicalEntry);
  }
  await flushLibraries();

  if (
    libraryClosureComplete &&
    effectiveArguments.some(
      (argument) =>
        argument.endsWith(".hxml") &&
        !isHaxe437OrdinaryInlineHxmlOption(argument),
    )
  ) {
    fail("invalid-syntax", "effectiveArguments:residual-hxml-token");
  }

  libraries.sort((left, right) =>
    Buffer.from(
      `${left.request}\0${left.fromFile}`,
    ).compare(Buffer.from(`${right.request}\0${right.fromFile}`)),
  );
  return Object.freeze({
    libraryClosureComplete,
    allowedRoots,
    entryHxmlFiles: Object.freeze(entryHxmlFiles),
    hxmlOccurrences: Object.freeze(orderedHxmlOccurrences),
    hxmlFiles: Object.freeze(bytewise(hxmlFiles)),
    libraryProvenanceFiles: Object.freeze(
      bytewise(libraryProvenanceFiles),
    ),
    classPaths: Object.freeze(bytewise(classPaths)),
    resourceInputs: Object.freeze(bytewise(resources)),
    libraries: Object.freeze(libraries),
    effectiveArguments: Object.freeze(effectiveArguments),
  });
}

/**
 * Inventories HXML for callers that pass `effectiveArguments` straight to
 * Haxe. Inline option values ending in `.hxml` are rejected because Haxe would
 * reopen that command-line token as another HXML file.
 */
export function inventoryHxml(
  options: HxmlInventoryOptions,
): Promise<HxmlInventory> {
  return inventoryHxmlWithPolicy(options, false);
}

/** @internal DevelopmentSession materializes accepted inline values safely. */
export function inventoryHxmlForDevelopmentSession(
  options: HxmlInventoryOptions,
): Promise<HxmlInventory> {
  return inventoryHxmlWithPolicy(options, true);
}
