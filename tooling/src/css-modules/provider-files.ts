import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { sha256Bytes } from "../artifacts/canonical-json.js";
import { cssModuleFailure } from "./error.js";
import type {
  CssModuleInput,
} from "./types.js";

export interface ProviderFile {
  readonly absolutePath: string;
  readonly bytes: Buffer;
  readonly input: CssModuleInput;
  readonly text: string;
}

export function providerProjectRoot(projectRoot: string): string {
  try {
    return realpathSync.native(projectRoot);
  } catch {
    return cssModuleFailure(
      "GENES-CSS-MODULE-PATH-011",
      "The CSS Module provider project root does not exist.",
      "projectRoot",
    );
  }
}

export function providerRelativePath(value: string, subject: string): string {
  if (
    value.length === 0 ||
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

export function readProviderFile(
  root: string,
  relativePath: string,
  subject: string,
): ProviderFile {
  const portable = providerRelativePath(relativePath, subject);
  const absolutePath = path.resolve(root, ...portable.split("/"));
  const relative = path.relative(root, absolutePath);
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
  try {
    const stats = lstatSync(absolutePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return cssModuleFailure(
        "GENES-CSS-MODULE-PATH-011",
        `${subject} must name one ordinary file, not a link or directory.`,
        subject,
      );
    }
    if (realpathSync.native(absolutePath) !== absolutePath) {
      return cssModuleFailure(
        "GENES-CSS-MODULE-PATH-011",
        `${subject} must not pass through a symbolic-link path.`,
        subject,
      );
    }
    const bytes = readFileSync(absolutePath);
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) {
      return cssModuleFailure(
        "GENES-CSS-MODULE-PROVIDER-016",
        `${subject} must contain valid UTF-8 text.`,
        subject,
      );
    }
    return Object.freeze({
      absolutePath,
      bytes,
      input: Object.freeze({ path: portable, sha256: sha256Bytes(bytes) }),
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
  }
}

export function assertProviderFileUnchanged(
  root: string,
  before: ProviderFile,
): void {
  const after = readProviderFile(root, before.input.path, before.input.path);
  if (after.input.sha256 !== before.input.sha256) {
    cssModuleFailure(
      "GENES-CSS-MODULE-MANIFEST-STALE-004",
      `CSS Module provider input ${before.input.path} changed while its ` +
        "manifest was being created.",
      before.input.path,
    );
  }
}
