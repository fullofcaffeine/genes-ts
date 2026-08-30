import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GenesAgentGuidanceError } from "./error.js";

export const GENES_AGENT_GUIDANCE_VERSION = 1 as const;
export const GENES_AGENT_GUIDANCE_BEGIN =
  "<!-- BEGIN @genes-ts/tooling:agent-guidance -->";
export const GENES_AGENT_GUIDANCE_END =
  "<!-- END @genes-ts/tooling:agent-guidance -->";

const RESERVED_MARKER = Buffer.from(
  "@genes-ts/tooling:agent-guidance",
  "utf8",
);
const BEGIN_MARKER = Buffer.from(GENES_AGENT_GUIDANCE_BEGIN, "utf8");
const END_MARKER = Buffer.from(GENES_AGENT_GUIDANCE_END, "utf8");
const VERSION_MARKER = Buffer.from(
  `<!-- genes-agent-guidance-version: ${GENES_AGENT_GUIDANCE_VERSION} -->`,
  "utf8",
);

export type GenesAgentGuidanceStatus = "current" | "missing" | "stale";
export type GenesAgentGuidanceInstallAction =
  | "created"
  | "inserted"
  | "updated"
  | "unchanged";

export interface GenesAgentGuidanceCheck {
  readonly path: string;
  readonly status: GenesAgentGuidanceStatus;
  readonly version: typeof GENES_AGENT_GUIDANCE_VERSION;
}

export interface GenesAgentGuidanceInstallResult {
  readonly action: GenesAgentGuidanceInstallAction;
  readonly path: string;
  readonly version: typeof GENES_AGENT_GUIDANCE_VERSION;
}

interface ByteLine {
  readonly contentEnd: number;
  readonly end: number;
  readonly start: number;
}

interface ManagedRegion {
  readonly end: number;
  readonly start: number;
}

interface TargetSnapshot {
  readonly bytes: Buffer | null;
  readonly file: string;
}

let canonicalGuidance: Buffer | null = null;

function byteLines(bytes: Buffer): readonly ByteLine[] {
  const lines: ByteLine[] = [];
  let start = 0;
  while (start < bytes.length) {
    const newline = bytes.indexOf(0x0a, start);
    const end = newline === -1 ? bytes.length : newline + 1;
    let contentEnd = newline === -1 ? bytes.length : newline;
    if (contentEnd > start && bytes[contentEnd - 1] === 0x0d) {
      contentEnd -= 1;
    }
    lines.push({ contentEnd, end, start });
    start = end;
  }
  return lines;
}

function lineEquals(bytes: Buffer, line: ByteLine, expected: Buffer): boolean {
  return (
    line.contentEnd - line.start === expected.length &&
    bytes.subarray(line.start, line.contentEnd).equals(expected)
  );
}

function malformedMarkers(file: string, detail: string): never {
  throw new GenesAgentGuidanceError(
    "malformed-markers",
    file,
    `${file} has ${detail}. Restore one exact managed marker pair, or remove every Genes guidance marker before retrying.`,
  );
}

function findManagedRegion(bytes: Buffer, file: string): ManagedRegion | null {
  const begins: ByteLine[] = [];
  const ends: ByteLine[] = [];
  for (const line of byteLines(bytes)) {
    const content = bytes.subarray(line.start, line.contentEnd);
    const isBegin = lineEquals(bytes, line, BEGIN_MARKER);
    const isEnd = lineEquals(bytes, line, END_MARKER);
    if (isBegin) begins.push(line);
    if (isEnd) ends.push(line);
    if (!isBegin && !isEnd && content.indexOf(RESERVED_MARKER) !== -1) {
      malformedMarkers(file, "an invalid Genes guidance marker");
    }
  }

  if (begins.length === 0 && ends.length === 0) return null;
  if (begins.length !== 1 || ends.length !== 1) {
    malformedMarkers(file, "missing or duplicate Genes guidance markers");
  }
  const begin = begins[0]!;
  const end = ends[0]!;
  if (begin.start >= end.start) {
    malformedMarkers(file, "Genes guidance markers in the wrong order");
  }
  return { start: begin.start, end: end.end };
}

function canonicalBytes(): Buffer {
  if (canonicalGuidance !== null) return Buffer.from(canonicalGuidance);
  const file = new URL(
    "../../agent-guidance/v1/AGENTS.md",
    import.meta.url,
  );
  const bytes = readFileSync(file);
  const filePath = fileURLToPath(file);
  const region = findManagedRegion(bytes, filePath);
  const versionAt = bytes.indexOf(VERSION_MARKER);
  if (
    region === null ||
    region.start !== 0 ||
    region.end !== bytes.length ||
    versionAt === -1 ||
    bytes.indexOf(VERSION_MARKER, versionAt + VERSION_MARKER.length) !== -1
  ) {
    throw new GenesAgentGuidanceError(
      "malformed-markers",
      filePath,
      "The packaged canonical guide must contain exactly one complete managed block.",
    );
  }
  canonicalGuidance = Buffer.from(bytes);
  return Buffer.from(bytes);
}

/** Returns a copy of the exact versioned block shipped with the package. */
export function readCanonicalGenesAgentGuidance(): Uint8Array {
  return canonicalBytes();
}

function resolvedProjectRoot(projectRoot: string): string {
  const root = path.resolve(projectRoot);
  try {
    if (!statSync(root).isDirectory()) {
      throw new GenesAgentGuidanceError(
        "invalid-project-root",
        root,
        `${root} is not a project directory.`,
      );
    }
  } catch (error) {
    if (error instanceof GenesAgentGuidanceError) throw error;
    throw new GenesAgentGuidanceError(
      "invalid-project-root",
      root,
      `${root} is not a readable project directory.`,
      { cause: error },
    );
  }
  return root;
}

function readTarget(projectRoot: string): TargetSnapshot {
  const root = resolvedProjectRoot(projectRoot);
  const file = path.join(root, "AGENTS.md");
  if (!existsSync(file)) return { bytes: null, file };
  try {
    const status = lstatSync(file);
    if (status.isSymbolicLink() || !status.isFile()) {
      throw new GenesAgentGuidanceError(
        "invalid-agents-file",
        file,
        `${file} must be a regular file, not a link or another file type.`,
      );
    }
    return { bytes: readFileSync(file), file };
  } catch (error) {
    if (error instanceof GenesAgentGuidanceError) throw error;
    throw new GenesAgentGuidanceError(
      "filesystem-error",
      file,
      `Genes could not read ${file}.`,
      { cause: error },
    );
  }
}

function inspectSnapshot(snapshot: TargetSnapshot): GenesAgentGuidanceCheck {
  if (snapshot.bytes === null) {
    return {
      path: snapshot.file,
      status: "missing",
      version: GENES_AGENT_GUIDANCE_VERSION,
    };
  }
  const region = findManagedRegion(snapshot.bytes, snapshot.file);
  if (region === null) {
    return {
      path: snapshot.file,
      status: "missing",
      version: GENES_AGENT_GUIDANCE_VERSION,
    };
  }
  const current = snapshot.bytes
    .subarray(region.start, region.end)
    .equals(canonicalBytes());
  return {
    path: snapshot.file,
    status: current ? "current" : "stale",
    version: GENES_AGENT_GUIDANCE_VERSION,
  };
}

/** Checks one project root without changing its AGENTS.md file. */
export function checkGenesAgentGuidance(
  projectRoot: string,
): GenesAgentGuidanceCheck {
  return inspectSnapshot(readTarget(projectRoot));
}

function appendCanonical(existing: Buffer, canonical: Buffer): Buffer {
  if (existing.length === 0) return canonical;
  if (existing[existing.length - 1] !== 0x0a) {
    return Buffer.concat([existing, Buffer.from("\n\n"), canonical]);
  }
  const hasBlankLine =
    (existing.length >= 2 && existing.subarray(-2).equals(Buffer.from("\n\n"))) ||
    (existing.length >= 4 &&
      existing.subarray(-4).equals(Buffer.from("\r\n\r\n")));
  if (hasBlankLine) {
    return Buffer.concat([existing, canonical]);
  }
  return Buffer.concat([existing, Buffer.from("\n"), canonical]);
}

function writeTarget(snapshot: TargetSnapshot, bytes: Buffer): void {
  try {
    writeFileSync(snapshot.file, bytes, {
      flag: snapshot.bytes === null ? "wx" : "w",
    });
  } catch (error) {
    throw new GenesAgentGuidanceError(
      "filesystem-error",
      snapshot.file,
      `Genes could not write ${snapshot.file}. Review the file before you retry.`,
      { cause: error },
    );
  }
}

/** Installs or updates only the reserved Genes block in a root AGENTS.md. */
export function installGenesAgentGuidance(
  projectRoot: string,
): GenesAgentGuidanceInstallResult {
  const snapshot = readTarget(projectRoot);
  const canonical = canonicalBytes();
  if (snapshot.bytes === null) {
    writeTarget(snapshot, canonical);
    return {
      action: "created",
      path: snapshot.file,
      version: GENES_AGENT_GUIDANCE_VERSION,
    };
  }

  const region = findManagedRegion(snapshot.bytes, snapshot.file);
  if (region === null) {
    writeTarget(snapshot, appendCanonical(snapshot.bytes, canonical));
    return {
      action: "inserted",
      path: snapshot.file,
      version: GENES_AGENT_GUIDANCE_VERSION,
    };
  }
  if (snapshot.bytes.subarray(region.start, region.end).equals(canonical)) {
    return {
      action: "unchanged",
      path: snapshot.file,
      version: GENES_AGENT_GUIDANCE_VERSION,
    };
  }

  writeTarget(
    snapshot,
    Buffer.concat([
      snapshot.bytes.subarray(0, region.start),
      canonical,
      snapshot.bytes.subarray(region.end),
    ]),
  );
  return {
    action: "updated",
    path: snapshot.file,
    version: GENES_AGENT_GUIDANCE_VERSION,
  };
}
