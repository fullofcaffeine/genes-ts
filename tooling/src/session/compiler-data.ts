import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { sha256Bytes } from "../artifacts/index.js";
import type {
  CompilerDataDeclaration,
  CompilerDataFile,
} from "./types.js";

/*
 * This module owns the private bridge from a trusted Haxe macro to host
 * validation. Haxe receives opaque file slots, while the validator receives
 * byte copies with no path authority. Public files still use the existing
 * admitted-artifact transaction.
 */
export const MAX_COMPILER_DATA_SLOTS = 64;
export const MAX_COMPILER_DATA_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_COMPILER_DATA_TOTAL_BYTES = 16 * 1024 * 1024;
export const COMPILER_DATA_DEFINE = "genes.tooling.compiler-data";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const DESCRIPTOR_PROTOCOL = "genes.tooling.compiler-data-request" as const;
const DESCRIPTOR_VERSION = 1 as const;

interface CompilerDataSlot {
  readonly id: string;
  readonly maxBytes: number;
  readonly name: string;
  readonly absolutePath: string;
}

export interface StagedCompilerData {
  readonly descriptorPath: string;
  readonly root: string;
  readonly slots: readonly CompilerDataSlot[];
}

export interface CapturedCompilerData {
  readonly files: readonly CompilerDataFile[];
  dispose(): void;
}

/**
 * Copies and checks the complete declaration list when the session starts.
 * Later caller mutations cannot change which IDs or byte limits Haxe receives.
 */
export function snapshotCompilerDataDeclarations(
  declarations: readonly CompilerDataDeclaration[] | undefined,
): readonly CompilerDataDeclaration[] {
  const source = declarations ?? [];
  if (source.length > MAX_COMPILER_DATA_SLOTS) {
    throw new Error(
      `compilerData accepts at most ${MAX_COMPILER_DATA_SLOTS} declarations`,
    );
  }
  const seen = new Set<string>();
  let total = 0;
  const snapshot = source.map((declaration, index) => {
    const id = declaration.id;
    const maxBytes = declaration.maxBytes;
    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      throw new Error(
        `compilerData[${index}].id must match ${ID_PATTERN.source}`,
      );
    }
    if (seen.has(id)) {
      throw new Error(`compilerData contains duplicate id: ${id}`);
    }
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes <= 0 ||
      maxBytes > MAX_COMPILER_DATA_FILE_BYTES
    ) {
      throw new Error(
        `compilerData ${id} maxBytes must be a positive safe integer no greater than ${MAX_COMPILER_DATA_FILE_BYTES}`,
      );
    }
    seen.add(id);
    total += maxBytes;
    if (total > MAX_COMPILER_DATA_TOTAL_BYTES) {
      throw new Error(
        `compilerData total maxBytes must not exceed ${MAX_COMPILER_DATA_TOTAL_BYTES}`,
      );
    }
    return Object.freeze({ id, maxBytes });
  });
  return Object.freeze(
    snapshot.sort((left, right) =>
      Buffer.from(left.id).compare(Buffer.from(right.id)),
    ),
  );
}

/**
 * Allocates opaque private slots and one descriptor for the current request.
 * The descriptor is a compiler input. It is never part of generated output.
 */
export function stageCompilerData(
  candidateRoot: string,
  declarations: readonly CompilerDataDeclaration[],
): StagedCompilerData | null {
  if (declarations.length === 0) return null;
  const root = path.join(candidateRoot, "compiler-data");
  const inputRoot = path.join(candidateRoot, "haxe-input");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(inputRoot, { recursive: true, mode: 0o700 });
  const slots = declarations.map((declaration, index) => {
    const name = `slot-${index.toString().padStart(4, "0")}.data`;
    return Object.freeze({
      id: declaration.id,
      maxBytes: declaration.maxBytes,
      name,
      absolutePath: path.join(root, name),
    });
  });
  const descriptorPath = path.join(inputRoot, "compiler-data-v1.descriptor");
  const descriptor = [
    `${DESCRIPTOR_PROTOCOL}-v${DESCRIPTOR_VERSION}`,
    ...slots.map((slot) =>
      [
        Buffer.from(slot.id, "utf8").toString("base64"),
        String(slot.maxBytes),
        Buffer.from(slot.absolutePath, "utf8").toString("base64"),
      ].join("\t"),
    ),
    "",
  ].join("\n");
  writeFileSync(descriptorPath, descriptor, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return Object.freeze({
    descriptorPath,
    root,
    slots: Object.freeze(slots),
  });
}

function sameFile(
  left: ReturnType<typeof fstatSync>,
  right: ReturnType<typeof fstatSync>,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.nlink === right.nlink
  );
}

function readSlot(slot: CompilerDataSlot): Buffer {
  let descriptor: ReturnType<typeof lstatSync>;
  try {
    descriptor = lstatSync(slot.absolutePath);
  } catch {
    throw new Error(`compiler data ${slot.id} is missing`);
  }
  if (
    descriptor.isSymbolicLink() ||
    !descriptor.isFile() ||
    descriptor.nlink !== 1
  ) {
    throw new Error(`compiler data ${slot.id} must be one real file`);
  }
  if (descriptor.size > slot.maxBytes) {
    throw new Error(`compiler data ${slot.id} exceeds its byte limit`);
  }
  let file: number | null = null;
  try {
    file = openSync(
      slot.absolutePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = fstatSync(file);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size > slot.maxBytes ||
      before.dev !== descriptor.dev ||
      before.ino !== descriptor.ino
    ) {
      throw new Error(`compiler data ${slot.id} changed before capture`);
    }
    const bytes = readFileSync(file);
    const after = fstatSync(file);
    const linked = lstatSync(slot.absolutePath);
    if (
      !sameFile(before, after) ||
      linked.isSymbolicLink() ||
      !linked.isFile() ||
      linked.nlink !== 1 ||
      linked.dev !== after.dev ||
      linked.ino !== after.ino ||
      linked.size !== after.size
    ) {
      throw new Error(`compiler data ${slot.id} changed during capture`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("compiler data ")) {
      throw error;
    }
    throw new Error(`compiler data ${slot.id} could not be read safely`);
  } finally {
    if (file !== null) closeSync(file);
  }
}

/**
 * Checks the complete private directory and copies every declared value.
 * It then removes the paths, so validation can read bytes but cannot gain
 * write authority over the candidate directory.
 */
export function captureCompilerData(
  staged: StagedCompilerData | null,
): CapturedCompilerData {
  if (staged === null) {
    return Object.freeze({
      files: Object.freeze([]),
      dispose() {},
    });
  }
  let rootEntries: string[];
  try {
    const root = lstatSync(staged.root);
    if (root.isSymbolicLink() || !root.isDirectory()) {
      throw new Error("compiler data root must be one real directory");
    }
    rootEntries = readdirSync(staged.root).sort();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("compiler data ")) {
      throw error;
    }
    throw new Error("compiler data root could not be inspected safely");
  }
  const expectedEntries = staged.slots.map((slot) => slot.name).sort();
  const expectedEntrySet = new Set(expectedEntries);
  if (rootEntries.some((entry) => !expectedEntrySet.has(entry))) {
    throw new Error("compiler data contains an unexpected slot");
  }
  const values = staged.slots.map((slot) => ({ slot, bytes: readSlot(slot) }));
  const finalEntries = readdirSync(staged.root).sort();
  if (
    finalEntries.length !== expectedEntries.length ||
    finalEntries.some((entry, index) => entry !== expectedEntries[index])
  ) {
    throw new Error("compiler data changed during capture");
  }
  rmSync(staged.descriptorPath, { force: true });
  rmSync(staged.root, { recursive: true, force: true });
  let active = true;
  const files = values.map(({ slot, bytes }) =>
    Object.freeze({
      id: slot.id,
      digest: sha256Bytes(bytes),
      sizeBytes: bytes.byteLength,
      readBytes(): Uint8Array {
        if (!active) {
          throw new Error(
            `compiler data ${slot.id} is no longer available after validation`,
          );
        }
        return Uint8Array.from(bytes);
      },
    }),
  );
  return Object.freeze({
    files: Object.freeze(files),
    dispose(): void {
      active = false;
      for (const value of values) value.bytes.fill(0);
    },
  });
}
