import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  ARTIFACT_PLAN_PROTOCOL,
  ARTIFACT_PLAN_VERSION,
  canonicalDigest,
  canonicalJson,
  sha256Bytes,
  type CanonicalJson,
  type ExpectedFileState,
  type PublicationPlan,
} from "../artifacts/index.js";
import {
  readFileState,
  sameFileState,
} from "../artifacts/filesystem.js";
import type { AcceptedGeneration, FileDelta, JsonValue } from "./types.js";
import {
  logicalOutputPath,
  type SessionLayout,
} from "./layout.js";
import type {
  GenesOutputInventory,
  GenesOwnedFile,
} from "./genes-output.js";

const ABSENT = Object.freeze({ kind: "absent" as const });

function state(file: GenesOwnedFile): ExpectedFileState {
  return Object.freeze({
    kind: "file" as const,
    sha256: file.digest,
    sizeBytes: file.sizeBytes,
    mode: file.mode,
  });
}

function bytewise(values: Iterable<string>): string[] {
  return [...values].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );
}

function stageRelative(
  layout: SessionLayout,
  candidateStageRelative: string,
  outputRelative: string,
): string {
  return `${candidateStageRelative}/output/${outputRelative}`;
}

export function sessionProjectDigest(layout: SessionLayout): string {
  return canonicalDigest({
    protocol: "genes.tooling.development-session-project.v1",
    projectIdentity: layout.projectIdentity,
    projectRoot: layout.projectRoot,
    publicOutput: layout.publicOutputAuthority,
  });
}

export function admissionDigest(
  layout: SessionLayout,
  manifestDigest: string,
  validatorPolicyFacts: JsonValue,
): string {
  return canonicalDigest({
    protocol: "genes.tooling.development-session-admission.v1",
    projectIdentity: sessionProjectDigest(layout),
    publicOutput: layout.publicOutputAuthority,
    manifestDigest,
    validatorPolicyFacts,
  } as CanonicalJson);
}

export interface PreparedPublication {
  readonly plan: PublicationPlan;
  readonly accepted: AcceptedGeneration;
}

export interface PublishedMarker {
  readonly manifestDigest: string | null;
  readonly state: ExpectedFileState;
}

/**
 * Reads the last outer commit marker without treating it as a current-session
 * admission. Its manifest digest is drift evidence only: a new session still
 * has to generate and admit its own revision 1 before a host may start.
 */
export function readPublishedMarker(
  layout: SessionLayout,
): PublishedMarker {
  const absolute = path.join(
    layout.projectRoot,
    ...layout.generationMarkerRelative.split("/"),
  );
  if (!existsSync(absolute)) {
    return Object.freeze({ manifestDigest: null, state: ABSENT });
  }
  const stats = lstatSync(absolute);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("accepted-generation marker is not a real file");
  }
  const bytes = readFileSync(absolute, "utf8");
  let decoded: unknown;
  try {
    decoded = JSON.parse(bytes);
  } catch {
    throw new Error("accepted-generation marker is not valid JSON");
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw new Error("accepted-generation marker is not an object");
  }
  const record = decoded as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "acceptedAt,generation,manifestDigest,protocol,publicOutput,revision,sessionNonce" ||
    record.protocol !== "genes.tooling.accepted-generation.v1" ||
    typeof record.sessionNonce !== "string" ||
    record.sessionNonce.length === 0 ||
    !Number.isInteger(record.generation) ||
    (record.generation as number) <= 0 ||
    !Number.isInteger(record.revision) ||
    (record.revision as number) <= 0 ||
    !Number.isInteger(record.acceptedAt) ||
    (record.acceptedAt as number) < 0 ||
    typeof record.manifestDigest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(record.manifestDigest) ||
    record.publicOutput !== layout.publicOutputAuthority ||
    `${canonicalJson(record as CanonicalJson)}\n` !== bytes
  ) {
    throw new Error("accepted-generation marker is invalid or non-canonical");
  }
  return Object.freeze({
    manifestDigest: record.manifestDigest,
    state: readFileState(
      layout.projectRoot,
      layout.generationMarkerRelative,
      "unexpected-live-state",
    ),
  });
}

/**
 * Builds one exact outer transaction from compiler ownership.
 *
 * Unchanged candidate copies are removed from the private stage because the
 * artifact publisher deliberately rejects undeclared stage files. Their live
 * bytes remain in place, while the new compiler manifest still truthfully
 * names them after commit.
 */
export function preparePublication(
  layout: SessionLayout,
  candidateStageRelative: string,
  candidate: GenesOutputInventory,
  prior: GenesOutputInventory | null,
  revision: number,
  generation: number,
  acceptedAt: number,
  compilerMode: "connected" | "direct",
  validatorPolicyFacts: JsonValue,
  sessionNonce: string,
  priorMarker: ExpectedFileState,
): PreparedPublication {
  const candidateByPath = new Map(
    candidate.files.map((file) => [file.relativePath, file] as const),
  );
  const priorByPath = new Map(
    (prior?.files ?? []).map((file) => [file.relativePath, file] as const),
  );
  const allOwned = bytewise(
    new Set([...candidateByPath.keys(), ...priorByPath.keys()]),
  );
  const created: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];
  const artifacts: PublicationPlan["artifacts"][number][] = [];

  for (const relative of allOwned) {
    const candidateFile = candidateByPath.get(relative);
    const priorFile = priorByPath.get(relative);
    const livePath = logicalOutputPath(layout, relative);
    const priorState =
      priorFile === undefined
        ? ABSENT
        : state(priorFile);
    const nextState = candidateFile === undefined ? ABSENT : state(candidateFile);
    const changes = !sameFileState(priorState, nextState);
    let stagedPath: string | null = null;
    if (candidateFile !== undefined && changes) {
      stagedPath = stageRelative(layout, candidateStageRelative, relative);
    } else if (candidateFile !== undefined) {
      rmSync(candidateFile.absolutePath, { force: true });
    }
    artifacts.push({ path: livePath, prior: priorState, next: nextState, stagedPath });
    if (changes && priorState.kind === "absent" && nextState.kind === "file") {
      created.push(livePath);
    } else if (
      changes &&
      priorState.kind === "file" &&
      nextState.kind === "absent"
    ) {
      deleted.push(livePath);
    } else if (changes) {
      updated.push(livePath);
    }
  }

  const manifestLivePath = logicalOutputPath(layout, candidate.manifestName);
  const manifestPrior =
    prior === null
      ? ABSENT
      : state(prior.manifestFile);
  const manifestNext = state(candidate.manifestFile);
  const manifestChanges = !sameFileState(manifestPrior, manifestNext);
  artifacts.push({
    path: manifestLivePath,
    prior: manifestPrior,
    next: manifestNext,
    stagedPath: manifestChanges
      ? stageRelative(layout, candidateStageRelative, candidate.manifestName)
      : null,
  });
  if (!manifestChanges) rmSync(candidate.manifestPath, { force: true });

  artifacts.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const markerStageRelative = `${candidateStageRelative}/generation.json`;
  const markerAbsolute = path.join(
    layout.projectRoot,
    ...markerStageRelative.split("/"),
  );
  mkdirSync(path.dirname(markerAbsolute), { recursive: true, mode: 0o700 });
  const marker = `${canonicalJson({
    protocol: "genes.tooling.accepted-generation.v1",
    sessionNonce,
    generation,
    revision,
    acceptedAt,
    manifestDigest: candidate.manifestDigest,
    publicOutput: layout.publicOutputAuthority,
  })}\n`;
  writeFileSync(markerAbsolute, marker, { mode: 0o600 });
  chmodSync(markerAbsolute, 0o600);

  const delta: FileDelta = Object.freeze({
    created: Object.freeze(bytewise(created)),
    updated: Object.freeze(bytewise(updated)),
    deleted: Object.freeze(bytewise(deleted)),
  });
  const accepted: AcceptedGeneration = Object.freeze({
    generation,
    revision,
    acceptedAt,
    manifestDigest: candidate.manifestDigest,
    compilerMode,
    files: delta,
    entryChanged:
      delta.created.includes(layout.publicOutputRelative) ||
      delta.updated.includes(layout.publicOutputRelative) ||
      delta.deleted.includes(layout.publicOutputRelative),
  });
  const authorization = admissionDigest(
    layout,
    candidate.manifestDigest,
    validatorPolicyFacts,
  );
  const plan: PublicationPlan = Object.freeze({
    protocol: ARTIFACT_PLAN_PROTOCOL,
    version: ARTIFACT_PLAN_VERSION,
    projectIdentity: sessionProjectDigest(layout),
    authorizationDigest: authorization,
    transactionRoot: layout.transactionRelative,
    stageRoot: candidateStageRelative,
    artifacts: Object.freeze(artifacts),
    commitMarker: Object.freeze({
      path: layout.generationMarkerRelative,
      prior: priorMarker,
      next: Object.freeze({
        kind: "file" as const,
        sha256: sha256Bytes(marker),
        sizeBytes: Buffer.byteLength(marker),
        mode: 0o600,
      }),
      stagedPath: markerStageRelative,
    }),
  });
  return Object.freeze({ plan, accepted });
}
