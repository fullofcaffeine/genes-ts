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
  type HxmlLibraryRequest,
} from "./types.js";

const DEFAULT_MAX_HXML_FILES = 1_000;
const DEFAULT_MAX_ARGUMENTS = 100_000;

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
    if (!existsSync(current)) {
      return;
    }
    if (lstatSync(current).isSymbolicLink()) {
      fail("unsafe-input", subject);
    }
  }
}

function tokenizeLine(
  line: string,
  file: string,
  lineNumber: number,
): readonly string[] {
  const tokens: string[] = [];
  let value = "";
  let quote: "\"" | "'" | null = null;
  let escaped = false;
  const push = (): void => {
    if (value.length > 0) {
      tokens.push(value);
      value = "";
    }
  };
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (escaped) {
      value += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else {
        value += character;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#") {
      break;
    }
    if (/\s/u.test(character)) {
      push();
      continue;
    }
    value += character;
  }
  if (escaped || quote !== null) {
    fail("invalid-syntax", `${file}:${lineNumber}`);
  }
  push();
  return Object.freeze(tokens);
}

function argumentsFromFile(file: string): readonly string[] {
  return Object.freeze(
    readFileSync(file, "utf8")
      .replaceAll("\r\n", "\n")
      .split("\n")
      .flatMap((line, index) => tokenizeLine(line, file, index + 1)),
  );
}

function expanded(
  value: string,
  environment: ((name: string) => string | null) | undefined,
  subject: string,
): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu,
    (_match, name: string) => {
      const replacement = environment?.(name) ?? null;
      if (replacement === null) {
        fail("missing-environment", `${subject}:${name}`);
      }
      return replacement;
    },
  );
}

function optionValue(
  args: readonly string[],
  index: number,
  names: readonly string[],
): { readonly value: string; readonly consumed: number } | null {
  const argument = args[index]!;
  for (const name of names) {
    if (argument === name) {
      const value = args[index + 1];
      if (value === undefined) {
        fail("invalid-syntax", `${name}:missing-value`);
      }
      return Object.freeze({ value, consumed: 1 });
    }
    if (argument.startsWith(`${name}=`)) {
      const value = argument.slice(name.length + 1);
      if (value.length === 0) {
        fail("invalid-syntax", `${name}:missing-value`);
      }
      return Object.freeze({ value, consumed: 0 });
    }
  }
  return null;
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

export async function inventoryHxml(
  options: HxmlInventoryOptions,
): Promise<HxmlInventory> {
  throwIfAborted(options.signal);
  const maxHxmlFiles = options.maxHxmlFiles ?? DEFAULT_MAX_HXML_FILES;
  const maxArguments = options.maxArguments ?? DEFAULT_MAX_ARGUMENTS;
  if (
    options.entryFiles.length === 0 ||
    !Number.isInteger(maxHxmlFiles) ||
    maxHxmlFiles <= 0 ||
    !Number.isInteger(maxArguments) ||
    maxArguments <= 0
  ) {
    fail("invalid-option", "inventory limits and entry files");
  }
  const workingDirectory = canonicalDirectory(
    options.workingDirectory,
    "workingDirectory",
  );
  const allowedRoots = Object.freeze(
    bytewise(
      new Set(
        options.allowedRoots.map((root, index) =>
          canonicalDirectory(root, `allowedRoots[${index}]`),
        ),
      ),
    ),
  );
  if (allowedRoots.length === 0) {
    fail("invalid-option", "allowedRoots");
  }

  const hxmlFiles = new Set<string>();
  const entryHxmlFiles: string[] = [];
  const classPaths = new Set<string>();
  const resources = new Set<string>();
  const libraries: HxmlLibrary[] = [];
  const libraryKeys = new Set<string>();
  let libraryClosureComplete = true;
  let argumentCount = 0;
  const resolverSignal = options.signal ?? new AbortController().signal;

  const collect = async (
    candidate: string,
    initialDirectory: string,
    subject: string,
  ): Promise<string> => {
    throwIfAborted(options.signal);
    assertNoSymlinkComponents(allowedRoots, candidate, subject);
    const file = canonicalFile(candidate, subject);
    assertAllowed(allowedRoots, file, subject);
    if (hxmlFiles.has(file)) {
      return file;
    }
    hxmlFiles.add(file);
    if (hxmlFiles.size > maxHxmlFiles) {
      fail("budget-exceeded", "hxmlFiles");
    }
    const args = argumentsFromFile(file);
    argumentCount += args.length;
    if (argumentCount > maxArguments) {
      fail("budget-exceeded", "arguments");
    }
    let cwd = initialDirectory;
    for (let index = 0; index < args.length; index += 1) {
      throwIfAborted(options.signal);
      const argument = args[index]!;
      const forbiddenOptions = options.argumentPolicy?.forbiddenOptions ?? [];
      const forbiddenOption = forbiddenOptions.find(
        (name) => argument === name || argument.startsWith(`${name}=`),
      );
      if (forbiddenOption !== undefined) {
        fail("invalid-option", `${file}:${forbiddenOption}`);
      }
      const define = optionValue(args, index, ["-D", "--define"]);
      const compactDefine =
        argument.startsWith("-D") && argument.length > 2
          ? argument.slice(2)
          : null;
      const defineValue = define?.value ?? compactDefine;
      if (defineValue !== null) {
        const defineName = defineValue.split("=", 1)[0]!;
        if (
          (options.argumentPolicy?.forbiddenDefines ?? []).includes(defineName)
        ) {
          fail("invalid-option", `${file}:define:${defineName}`);
        }
      }
      const cwdOption = optionValue(args, index, ["-C", "--cwd"]);
      if (cwdOption !== null) {
        const resolved = path.resolve(
          cwd,
          expanded(cwdOption.value, options.environment, `${file}:cwd`),
        );
        assertAllowed(allowedRoots, resolved, `${file}:cwd`);
        assertNoSymlinkComponents(allowedRoots, resolved, `${file}:cwd`);
        cwd = canonicalDirectory(resolved, `${file}:cwd`);
        index += cwdOption.consumed;
        continue;
      }
      const classPath = optionValue(args, index, [
        "-p",
        "-cp",
        "--class-path",
      ]);
      if (classPath !== null) {
        const resolved = path.resolve(
          cwd,
          expanded(classPath.value, options.environment, `${file}:classPath`),
        );
        assertAllowed(allowedRoots, resolved, `${file}:classPath`);
        assertNoSymlinkComponents(
          allowedRoots,
          resolved,
          `${file}:classPath`,
        );
        classPaths.add(resolved);
        index += classPath.consumed;
        continue;
      }
      const resource = optionValue(args, index, [
        "-r",
        "-resource",
        "--resource",
      ]);
      if (resource !== null) {
        const expandedResource = expanded(
          resource.value,
          options.environment,
          `${file}:resource`,
        );
        const separator = expandedResource.lastIndexOf("@");
        const resourcePath =
          separator === -1
            ? expandedResource
            : expandedResource.slice(0, separator);
        const resolved = path.resolve(cwd, resourcePath);
        assertAllowed(allowedRoots, resolved, `${file}:resource`);
        assertNoSymlinkComponents(
          allowedRoots,
          resolved,
          `${file}:resource`,
        );
        resources.add(resolved);
        index += resource.consumed;
        continue;
      }
      const library = optionValue(args, index, ["-L", "-lib", "--library"]);
      if (library !== null) {
        const request = libraryRequest(library.value, file, cwd);
        const key = `${request.request}\0${request.fromFile}\0${request.workingDirectory}`;
        if (!libraryKeys.has(key)) {
          libraryKeys.add(key);
          libraries.push(
            Object.freeze({
              request: request.request,
              name: request.name,
              version: request.version,
              fromFile: request.fromFile,
            }),
          );
          let resolvedFiles: readonly string[] = Object.freeze([]);
          if (options.resolveLibrary === undefined) {
            libraryClosureComplete = false;
          } else {
            try {
              resolvedFiles =
                (await awaitWithAbort(
                  options.resolveLibrary(request, {
                    signal: resolverSignal,
                  }),
                  options.signal,
                )) ?? Object.freeze([]);
            } catch {
              fail("resolver-failure", `${file}:library:${request.request}`);
            }
          }
          for (const [resolvedIndex, resolvedFile] of resolvedFiles.entries()) {
            if (!path.isAbsolute(resolvedFile)) {
              fail(
                "resolver-failure",
                `${file}:library:${request.request}[${resolvedIndex}]`,
              );
            }
            await collect(
              resolvedFile,
              path.dirname(resolvedFile),
              `${file}:library:${request.request}[${resolvedIndex}]`,
            );
          }
        }
        index += library.consumed;
        continue;
      }
      if (!argument.startsWith("-") && argument.endsWith(".hxml")) {
        const nested = path.resolve(
          cwd,
          expanded(argument, options.environment, `${file}:nested`),
        );
        await collect(nested, cwd, `${file}:nested:${argument}`);
      }
    }
    return file;
  };

  for (const [index, entry] of options.entryFiles.entries()) {
    const candidate = path.resolve(
      workingDirectory,
      expanded(entry, options.environment, `entryFiles[${index}]`),
    );
    const canonicalEntry = await collect(
      candidate,
      workingDirectory,
      `entryFiles[${index}]`,
    );
    entryHxmlFiles.push(canonicalEntry);
  }

  libraries.sort((left, right) =>
    Buffer.from(
      `${left.request}\0${left.fromFile}`,
    ).compare(Buffer.from(`${right.request}\0${right.fromFile}`)),
  );
  return Object.freeze({
    libraryClosureComplete,
    entryHxmlFiles: Object.freeze(entryHxmlFiles),
    hxmlFiles: Object.freeze(bytewise(hxmlFiles)),
    classPaths: Object.freeze(bytewise(classPaths)),
    resourceInputs: Object.freeze(bytewise(resources)),
    libraries: Object.freeze(libraries),
  });
}
