import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
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

interface LockRecord {
  readonly protocol: typeof LOCK_PROTOCOL;
  readonly projectIdentity: string;
  readonly outputIdentity: string;
  readonly hostIdentity: string;
  readonly pid: number;
  readonly nonce: string;
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
    outputIdentity: layout.publicOutputRelative,
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
