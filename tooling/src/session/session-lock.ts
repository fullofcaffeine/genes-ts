import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  canonicalJson,
  sha256Bytes,
  type CanonicalJson,
} from "../artifacts/index.js";
import type { SessionLayout } from "./layout.js";

const LOCK_PROTOCOL = "genes.tooling.development-session-lock.v1";
const ROOT_OWNER_PROTOCOL =
  "genes.tooling.development-session-root-owner.v1" as const;

interface LockRecord {
  readonly protocol: typeof LOCK_PROTOCOL;
  readonly projectIdentity: string;
  readonly outputIdentity: string;
  readonly hostIdentity: string;
  readonly pid: number;
  readonly nonce: string;
}

interface RootOwnerRecord {
  readonly protocol: typeof ROOT_OWNER_PROTOCOL;
  readonly projectIdentity: string;
  readonly publicOutputRootAuthority: string;
  readonly publicOutputRootPath: string;
  readonly publicEntryAuthority: string;
  readonly publicEntryPath: string;
}

function claimRootOwner(layout: SessionLayout): void {
  const absolute = path.join(
    layout.projectRoot,
    ...layout.rootOwnerRelative.split("/"),
  );
  const record: RootOwnerRecord = {
    protocol: ROOT_OWNER_PROTOCOL,
    projectIdentity: layout.projectIdentity,
    publicOutputRootAuthority: layout.publicOutputRootAuthority,
    publicOutputRootPath: layout.publicOutputRootRelative ?? ".",
    publicEntryAuthority: layout.publicEntryAuthority,
    publicEntryPath: layout.publicOutputRelative,
  };
  const bytes = `${canonicalJson({
    protocol: record.protocol,
    projectIdentity: record.projectIdentity,
    publicOutputRootAuthority: record.publicOutputRootAuthority,
    publicOutputRootPath: record.publicOutputRootPath,
    publicEntryAuthority: record.publicEntryAuthority,
    publicEntryPath: record.publicEntryPath,
  })}\n`;
  try {
    const descriptor = openSync(absolute, "wx", 0o600);
    try {
      writeFileSync(descriptor, bytes);
    } finally {
      closeSync(descriptor);
    }
    return;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { readonly code?: string }).code
        : undefined;
    if (code !== "EEXIST") throw error;
  }
  if (lstatSync(absolute).isSymbolicLink()) {
    throw new Error("development session root owner is a symbolic link");
  }
  const existing = readFileSync(absolute, "utf8");
  let decoded: unknown;
  try {
    decoded = JSON.parse(existing);
  } catch {
    throw new Error("development session root owner is invalid");
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw new Error("development session root owner is invalid");
  }
  const fields = decoded as Record<string, unknown>;
  if (
    Object.keys(fields).sort().join(",") !==
      "projectIdentity,protocol,publicEntryAuthority,publicEntryPath,publicOutputRootAuthority,publicOutputRootPath" ||
    fields.protocol !== ROOT_OWNER_PROTOCOL ||
    typeof fields.projectIdentity !== "string" ||
    typeof fields.publicOutputRootAuthority !== "string" ||
    typeof fields.publicOutputRootPath !== "string" ||
    typeof fields.publicEntryAuthority !== "string" ||
    typeof fields.publicEntryPath !== "string"
  ) {
    throw new Error("development session root owner is invalid");
  }
  const previous: RootOwnerRecord = Object.freeze({
    protocol: ROOT_OWNER_PROTOCOL,
    projectIdentity: fields.projectIdentity,
    publicOutputRootAuthority: fields.publicOutputRootAuthority,
    publicOutputRootPath: fields.publicOutputRootPath,
    publicEntryAuthority: fields.publicEntryAuthority,
    publicEntryPath: fields.publicEntryPath,
  });
  const canonical =
    `${canonicalJson({
      protocol: previous.protocol,
      projectIdentity: previous.projectIdentity,
      publicOutputRootAuthority: previous.publicOutputRootAuthority,
      publicOutputRootPath: previous.publicOutputRootPath,
      publicEntryAuthority: previous.publicEntryAuthority,
      publicEntryPath: previous.publicEntryPath,
    })}\n` === existing;
  const samePhysical = (left: string, right: string): boolean => {
    const leftAbsolute = path.join(layout.projectRoot, ...left.split("/"));
    const rightAbsolute = path.join(layout.projectRoot, ...right.split("/"));
    return (
      existsSync(leftAbsolute) &&
      existsSync(rightAbsolute) &&
      realpathSync.native(leftAbsolute) === realpathSync.native(rightAbsolute)
    );
  };
  const samePhysicalRoot = samePhysical(
    previous.publicOutputRootPath,
    record.publicOutputRootPath,
  );
  const genesDirectory = path.join(layout.projectRoot, ".genes");
  const genesCaseAlias = path.join(layout.projectRoot, ".GENES");
  const projectFilesystemIsCaseInsensitive =
    existsSync(genesDirectory) &&
    existsSync(genesCaseAlias) &&
    realpathSync.native(genesDirectory) === realpathSync.native(genesCaseAlias);
  if (
    !canonical ||
    previous.projectIdentity !== record.projectIdentity ||
    previous.publicOutputRootAuthority !== record.publicOutputRootAuthority ||
    previous.publicEntryAuthority !== record.publicEntryAuthority ||
    (previous.publicOutputRootPath !== record.publicOutputRootPath &&
      !samePhysicalRoot &&
      !projectFilesystemIsCaseInsensitive) ||
    (previous.publicEntryPath !== record.publicEntryPath &&
      !samePhysical(previous.publicEntryPath, record.publicEntryPath) &&
      !samePhysicalRoot &&
      !projectFilesystemIsCaseInsensitive)
  ) {
    throw new Error(
      "public output root is already bound to a different development-session entry",
    );
  }
}

function pidIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { readonly code?: string }).code === "EPERM"
    );
  }
}

function decode(bytes: string): LockRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(bytes);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "hostIdentity,nonce,outputIdentity,pid,projectIdentity,protocol" ||
    record.protocol !== LOCK_PROTOCOL ||
    typeof record.projectIdentity !== "string" ||
    typeof record.outputIdentity !== "string" ||
    typeof record.hostIdentity !== "string" ||
    typeof record.nonce !== "string" ||
    !Number.isInteger(record.pid) ||
    (record.pid as number) <= 0
  ) {
    return null;
  }
  const decoded = record as unknown as LockRecord;
  return `${canonicalJson(decoded as unknown as CanonicalJson)}\n` === bytes
    ? decoded
    : null;
}

export interface SessionLock {
  release(): void;
}

/** Claims one session lifetime without adopting or terminating another PID. */
export function acquireSessionLock(layout: SessionLayout): SessionLock {
  const absolute = path.join(
    layout.projectRoot,
    ...layout.sessionLockRelative.split("/"),
  );
  const record: LockRecord = {
    protocol: LOCK_PROTOCOL,
    projectIdentity: layout.projectIdentity,
    outputIdentity: layout.publicOutputRootAuthority,
    hostIdentity: sha256Bytes(`genes.tooling.host\0${os.hostname()}`),
    pid: process.pid,
    nonce: randomBytes(32).toString("hex"),
  };
  const bytes = `${canonicalJson(record as unknown as CanonicalJson)}\n`;

  const claim = (): void => {
    let descriptor: number | null = null;
    try {
      descriptor = openSync(absolute, "wx", 0o600);
      writeFileSync(descriptor, bytes);
      closeSync(descriptor);
      descriptor = null;
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor);
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { readonly code?: string }).code
          : undefined;
      if (code !== "EEXIST") throw error;
      if (lstatSync(absolute).isSymbolicLink()) {
        throw new Error("development session lock is a symbolic link");
      }
      const previousBytes = readFileSync(absolute, "utf8");
      const previous = decode(previousBytes);
      if (
        previous === null ||
        previous.hostIdentity !== record.hostIdentity ||
        previous.projectIdentity !== record.projectIdentity ||
        previous.outputIdentity !== record.outputIdentity
      ) {
        throw new Error("development session lock is not trusted");
      }
      if (pidIsLive(previous.pid)) {
        throw new Error(
          `another development session already owns this output (pid ${previous.pid})`,
        );
      }
      if (readFileSync(absolute, "utf8") !== previousBytes) {
        throw new Error("development session lock changed while reclaiming it");
      }
      unlinkSync(absolute);
      claim();
    }
  };

  claim();
  try {
    claimRootOwner(layout);
  } catch (error) {
    if (existsSync(absolute) && readFileSync(absolute, "utf8") === bytes) {
      unlinkSync(absolute);
    }
    throw error;
  }
  let released = false;
  return Object.freeze({
    release(): void {
      if (released) return;
      released = true;
      try {
        if (existsSync(absolute) && readFileSync(absolute, "utf8") === bytes) {
          unlinkSync(absolute);
        }
      } catch {
        // Exact bytes are the release authority; never remove a replacement.
      }
    },
  });
}
