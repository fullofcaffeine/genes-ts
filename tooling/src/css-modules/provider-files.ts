import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { types as utilTypes } from "node:util";

import { cssModuleFailure } from "./error.js";
import type { CssModuleBinding, CssModuleInput } from "./types.js";

const MAX_PORTABLE_PATH_BYTES = 4096;
export const MAX_PROVIDER_FILE_BYTES = 2 * 1024 * 1024;

export interface ProviderFile {
  readonly bytes: Buffer;
  readonly input: CssModuleInput;
  readonly text: string;
}

type InertRecord = Readonly<Record<string, unknown>>;

function providerFailure(message: string, subject: string): never {
  return cssModuleFailure("GENES-CSS-MODULE-PROVIDER-016", message, subject);
}

/** Reads an exact plain record without invoking caller-owned accessors or proxies. */
export function providerRecord(
  value: unknown,
  expectedKeys: readonly string[],
  subject: string,
  failure: (message: string, subject: string) => never = providerFailure,
): InertRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  ) {
    return failure(`${subject} must be one plain data object.`, subject);
  }
  let prototype: object | null;
  let symbols: readonly symbol[];
  let descriptors: Readonly<Record<string, PropertyDescriptor>>;
  try {
    prototype = Object.getPrototypeOf(value);
    symbols = Object.getOwnPropertySymbols(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return failure(`${subject} must be one plain data object.`, subject);
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    symbols.length > 0
  ) {
    return failure(`${subject} must be one plain data object.`, subject);
  }
  const actualKeys = Object.keys(descriptors).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (actualKeys.join("\n") !== sortedExpected.join("\n")) {
    return failure(
      `${subject} must contain exactly: ${sortedExpected.join(", ")}.`,
      subject,
    );
  }
  const result: Record<string, unknown> = {};
  for (const key of sortedExpected) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      return failure(
        `${subject} properties must be inert data values, not accessors.`,
        subject,
      );
    }
    result[key] = descriptor.value;
  }
  return Object.freeze(result);
}

export function providerBinding(value: unknown): CssModuleBinding {
  const record = providerRecord(
    value,
    [
      "companionType",
      "generatedModule",
      "haxeOwner",
      "hostModulePath",
      "request",
    ],
    "binding",
  );
  const companionType = record.companionType;
  const generatedModule = record.generatedModule;
  const haxeOwner = record.haxeOwner;
  const hostModulePath = record.hostModulePath;
  const request = record.request;
  if (
    typeof companionType !== "string" ||
    typeof generatedModule !== "string" ||
    typeof haxeOwner !== "string" ||
    typeof hostModulePath !== "string" ||
    typeof request !== "string"
  ) {
    return providerFailure("binding fields must be strings.", "binding");
  }
  return Object.freeze({
    companionType,
    generatedModule,
    haxeOwner,
    hostModulePath,
    request,
  });
}

export function providerProjectRoot(projectRoot: unknown): string {
  if (typeof projectRoot !== "string") {
    return cssModuleFailure(
      "GENES-CSS-MODULE-PATH-011",
      "The CSS Module provider project root must be a path string.",
      "projectRoot",
    );
  }
  try {
    const root = realpathSync.native(projectRoot);
    if (!lstatSync(root).isDirectory()) throw new Error("not a directory");
    return root;
  } catch {
    return cssModuleFailure(
      "GENES-CSS-MODULE-PATH-011",
      "The CSS Module provider project root does not exist.",
      "projectRoot",
    );
  }
}

export function providerRelativePath(value: unknown, subject: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > MAX_PORTABLE_PATH_BYTES ||
    value.includes("\\") ||
    value.includes(":") ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    path.posix.isAbsolute(value) ||
    value === ".." ||
    value.startsWith("../") ||
    path.posix.normalize(value) !== value ||
    value.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    return cssModuleFailure(
      "GENES-CSS-MODULE-PATH-011",
      `${subject} must be a normalized project-relative path using forward slashes.`,
      subject,
    );
  }
  return value;
}

function absoluteProviderPath(root: string, portable: string, subject: string): string {
  const absolute = path.resolve(root, ...portable.split("/"));
  const relative = path.relative(root, absolute);
  if (
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    return cssModuleFailure(
      "GENES-CSS-MODULE-PATH-011",
      `${subject} leaves the CSS Module provider project root.`,
      subject,
    );
  }
  return absolute;
}

/** Reads one bounded ordinary UTF-8 file and records its exact bytes. */
export function readProviderFile(
  root: string,
  relativePath: unknown,
  subject: string,
): ProviderFile {
  const portable = providerRelativePath(relativePath, subject);
  const absolute = absoluteProviderPath(root, portable, subject);
  let descriptor: number | undefined;
  try {
    if (realpathSync.native(absolute) !== absolute) {
      return cssModuleFailure(
        "GENES-CSS-MODULE-PATH-011",
        `${subject} must not pass through a symbolic-link path.`,
        subject,
      );
    }
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    const named = lstatSync(absolute, { bigint: true });
    if (
      !opened.isFile() ||
      named.isSymbolicLink() ||
      opened.dev !== named.dev ||
      opened.ino !== named.ino
    ) {
      return cssModuleFailure(
        "GENES-CSS-MODULE-PATH-011",
        `${subject} must name one ordinary file, not a link or directory.`,
        subject,
      );
    }
    if (opened.size > BigInt(MAX_PROVIDER_FILE_BYTES)) {
      return providerFailure(
        `${subject} exceeds the ${MAX_PROVIDER_FILE_BYTES}-byte provider limit.`,
        subject,
      );
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let readBytes = 0;
    while (readBytes < bytes.byteLength) {
      const count = readSync(
        descriptor,
        bytes,
        readBytes,
        bytes.byteLength - readBytes,
        readBytes,
      );
      if (count === 0) break;
      readBytes += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    const finalNamed = lstatSync(absolute, { bigint: true });
    if (
      readBytes !== bytes.byteLength ||
      opened.dev !== after.dev ||
      opened.ino !== after.ino ||
      opened.size !== after.size ||
      opened.mtimeNs !== after.mtimeNs ||
      opened.ctimeNs !== after.ctimeNs ||
      after.dev !== finalNamed.dev ||
      after.ino !== finalNamed.ino ||
      after.size !== finalNamed.size ||
      after.mtimeNs !== finalNamed.mtimeNs ||
      after.ctimeNs !== finalNamed.ctimeNs ||
      realpathSync.native(absolute) !== absolute
    ) {
      return cssModuleFailure(
        "GENES-CSS-MODULE-MANIFEST-STALE-004",
        `CSS Module provider input ${portable} changed while it was read.`,
        portable,
      );
    }
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) {
      return providerFailure(`${subject} must contain valid UTF-8 text.`, subject);
    }
    return Object.freeze({
      bytes,
      input: Object.freeze({
        path: portable,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }),
      text,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "CssModuleCompanionError") {
      throw error;
    }
    return cssModuleFailure(
      "GENES-CSS-MODULE-FILE-MISSING-002",
      `Cannot read CSS Module provider input ${portable}.`,
      portable,
    );
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        providerFailure(
          `Cannot close CSS Module provider input ${portable}.`,
          portable,
        );
      }
    }
  }
}

export function assertProviderFileUnchanged(root: string, before: ProviderFile): void {
  let after: ProviderFile;
  try {
    after = readProviderFile(root, before.input.path, before.input.path);
  } catch {
    return cssModuleFailure(
      "GENES-CSS-MODULE-MANIFEST-STALE-004",
      `CSS Module provider input ${before.input.path} changed while its manifest was created.`,
      before.input.path,
    );
  }
  if (after.input.sha256 !== before.input.sha256) {
    return cssModuleFailure(
      "GENES-CSS-MODULE-MANIFEST-STALE-004",
      `CSS Module provider input ${before.input.path} changed while its manifest was created.`,
      before.input.path,
    );
  }
}
