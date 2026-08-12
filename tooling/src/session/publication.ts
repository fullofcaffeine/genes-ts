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
import {
  portablePathIdentity,
  validatePortableRelativePath,
} from "../artifacts/validate-plan.js";
import type { AcceptedGeneration, FileDelta, JsonValue } from "./types.js";
import {
  logicalOutputPath,
  portableProjectPathsOverlap,
  samePhysicalSessionPath,
  type SessionLayout,
} from "./layout.js";
import type {
  GenesOutputInventory,
  GenesOwnedFile,
} from "./genes-output.js";
import {
  supplementalState,
  type SupplementalFile,
} from "./prepared-files.js";

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
    protocol: "genes.tooling.development-session-project.v2",
    projectIdentity: layout.projectIdentity,
    projectRoot: layout.projectRoot,
    publicOutputRoot: layout.publicOutputRootAuthority,
  });
}

/** The project identity written by DevelopmentSession before root ownership. */
export function legacySessionProjectDigest(layout: SessionLayout): string {
  return canonicalDigest({
    protocol: "genes.tooling.development-session-project.v1",
    projectIdentity: layout.projectIdentity,
    projectRoot: layout.projectRoot,
    publicOutput: layout.publicEntryAuthority,
  });
}

export function admissionDigest(
  layout: SessionLayout,
  manifestDigest: string,
  validatorPolicyFacts: JsonValue,
  supplementalFiles: readonly PublishedSupplementalFile[] = [],
  recoveryMode: AdmissionRecoveryMode = "replayable",
): string {
  return canonicalDigest({
    protocol: "genes.tooling.development-session-admission.v5",
    projectIdentity: sessionProjectDigest(layout),
    publicOutputRoot: layout.publicOutputRootAuthority,
    publicEntry: layout.publicEntryAuthority,
    manifestDigest,
    supplementalFiles: supplementalFiles.map((file) => ({
      source: file.source,
      path: file.path,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      mode: file.mode,
    })),
    recoveryMode,
    validatorPolicyFacts,
  } as CanonicalJson);
}

export type AdmissionRecoveryMode = "replayable" | "rebuild-required";

/** Rebuilds the exact identity written before recovery mode joined admission. */
function v4AdmissionDigest(
  layout: SessionLayout,
  manifestDigest: string,
  validatorPolicyFacts: JsonValue,
  supplementalFiles: readonly PublishedSupplementalFile[] = [],
): string {
  return canonicalDigest({
    protocol: "genes.tooling.development-session-admission.v4",
    projectIdentity: sessionProjectDigest(layout),
    publicOutputRoot: layout.publicOutputRootAuthority,
    publicEntry: layout.publicEntryAuthority,
    manifestDigest,
    supplementalFiles: supplementalFiles.map((file) => ({
      source: file.source,
      path: file.path,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      mode: file.mode,
    })),
    validatorPolicyFacts,
  } as CanonicalJson);
}

/** Rebuilds the exact admission identity written by the older v3 format. */
export function legacySupplementalAdmissionDigest(
  layout: SessionLayout,
  manifestDigest: string,
  validatorPolicyFacts: JsonValue,
  supplementalFiles: readonly PublishedSupplementalFile[],
): string {
  return canonicalDigest({
    protocol: "genes.tooling.development-session-admission.v3",
    projectIdentity: sessionProjectDigest(layout),
    publicOutputRoot: layout.publicOutputRootAuthority,
    publicEntry: layout.publicEntryAuthority,
    manifestDigest,
    supplementalFiles: supplementalFiles.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      mode: file.mode,
    })),
    validatorPolicyFacts,
  } as CanonicalJson);
}

/** The admission identity emitted before supplemental files joined a build. */
export function rootAdmissionDigest(
  layout: SessionLayout,
  manifestDigest: string,
  validatorPolicyFacts: JsonValue,
): string {
  return canonicalDigest({
    protocol: "genes.tooling.development-session-admission.v2",
    projectIdentity: sessionProjectDigest(layout),
    publicOutputRoot: layout.publicOutputRootAuthority,
    publicEntry: layout.publicEntryAuthority,
    manifestDigest,
    validatorPolicyFacts,
  } as CanonicalJson);
}

/** The admission identity written by DevelopmentSession before root ownership. */
export function legacyAdmissionDigest(
  layout: SessionLayout,
  manifestDigest: string,
  validatorPolicyFacts: JsonValue,
): string {
  return canonicalDigest({
    protocol: "genes.tooling.development-session-admission.v1",
    projectIdentity: legacySessionProjectDigest(layout),
    publicOutput: layout.publicEntryAuthority,
    manifestDigest,
    validatorPolicyFacts,
  } as CanonicalJson);
}

export interface PreparedPublication {
  readonly plan: PublicationPlan;
  readonly accepted: AcceptedGeneration;
}

export interface PublishedMarker {
  readonly format: "absent" | "v2" | "v3" | "v4";
  readonly manifestDigest: string | null;
  readonly accepted: Readonly<{
    readonly generation: number;
    readonly revision: number;
    readonly acceptedAt: number;
  }> | null;
  readonly state: ExpectedFileState;
  readonly supplementalFiles: readonly PublishedSupplementalFile[];
}

export interface PublishedSupplementalFile {
  /** `legacy` means the older v3 marker did not record which step owned it. */
  readonly source: "legacy" | "prepared" | "validator";
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mode: number;
}

function parseSupplementalFiles(
  value: unknown,
  format: "v3" | "v4",
): readonly PublishedSupplementalFile[] {
  if (!Array.isArray(value)) {
    throw new Error("accepted-generation supplemental files are not an array");
  }
  const paths = new Map<string, string>();
  const files = value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("accepted-generation supplemental file is not an object");
    }
    const record = entry as Record<string, unknown>;
    const expectedKeys = format === "v3"
      ? "mode,path,sha256,sizeBytes"
      : "mode,path,sha256,sizeBytes,source";
    if (
      Object.keys(record).sort().join(",") !== expectedKeys ||
      (format === "v4" &&
        record.source !== "prepared" &&
        record.source !== "validator") ||
      typeof record.path !== "string" ||
      typeof record.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(record.sha256) ||
      !Number.isInteger(record.sizeBytes) ||
      (record.sizeBytes as number) < 0 ||
      !Number.isInteger(record.mode) ||
      (record.mode as number) < 0 ||
      (record.mode as number) > 0o777
    ) {
      throw new Error("accepted-generation supplemental file is invalid");
    }
    const portablePath = validatePortableRelativePath(
      record.path,
      "accepted-generation supplemental file",
    );
    const identity = portablePathIdentity(portablePath);
    if (paths.has(identity)) {
      throw new Error("accepted-generation supplemental files collide by path");
    }
    paths.set(identity, portablePath);
    return Object.freeze({
      source:
        format === "v3"
          ? "legacy" as const
          : record.source as "prepared" | "validator",
      path: portablePath,
      sha256: record.sha256,
      sizeBytes: record.sizeBytes as number,
      mode: record.mode as number,
    });
  });
  return Object.freeze(
    files.sort((left, right) =>
      Buffer.from(left.path).compare(Buffer.from(right.path)),
    ),
  );
}

export interface LegacyAcceptedGenerationRecord {
  readonly protocol: "genes.tooling.accepted-generation.v1";
  readonly sessionNonce: string;
  readonly generation: number;
  readonly revision: number;
  readonly acceptedAt: number;
  readonly manifestDigest: string;
  readonly publicOutput: string;
  readonly publicOutputPath: string;
}

/** Parses the exact marker format emitted by the released entry-scoped session. */
export function parseLegacyAcceptedGeneration(
  layout: SessionLayout,
  bytes: string,
): LegacyAcceptedGenerationRecord {
  let decoded: unknown;
  try {
    decoded = JSON.parse(bytes);
  } catch {
    throw new Error("legacy accepted-generation marker is not valid JSON");
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw new Error("legacy accepted-generation marker is not an object");
  }
  const fields = decoded as Record<string, unknown>;
  if (
    Object.keys(fields).sort().join(",") !==
      "acceptedAt,generation,manifestDigest,protocol,publicOutput,publicOutputPath,revision,sessionNonce" ||
    fields.protocol !== "genes.tooling.accepted-generation.v1" ||
    typeof fields.sessionNonce !== "string" ||
    fields.sessionNonce.length === 0 ||
    !Number.isInteger(fields.generation) ||
    (fields.generation as number) <= 0 ||
    !Number.isInteger(fields.revision) ||
    (fields.revision as number) <= 0 ||
    !Number.isInteger(fields.acceptedAt) ||
    (fields.acceptedAt as number) < 0 ||
    typeof fields.manifestDigest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(fields.manifestDigest) ||
    fields.publicOutput !== layout.publicEntryAuthority ||
    typeof fields.publicOutputPath !== "string" ||
    `${canonicalJson(fields as CanonicalJson)}\n` !== bytes
  ) {
    throw new Error("legacy accepted-generation marker is invalid or non-canonical");
  }
  const record = Object.freeze({
    protocol: "genes.tooling.accepted-generation.v1" as const,
    sessionNonce: fields.sessionNonce,
    generation: fields.generation as number,
    revision: fields.revision as number,
    acceptedAt: fields.acceptedAt as number,
    manifestDigest: fields.manifestDigest,
    publicOutput: fields.publicOutput,
    publicOutputPath: fields.publicOutputPath,
  });
  let recordedOutputRelative: string;
  try {
    recordedOutputRelative = validatePortableRelativePath(
      record.publicOutputPath,
      "legacy accepted-generation publicOutputPath",
    );
  } catch {
    throw new Error("legacy accepted-generation marker has an invalid output path");
  }
  if (portablePathIdentity(recordedOutputRelative) !== record.publicOutput) {
    throw new Error("legacy accepted-generation marker has an invalid output identity");
  }
  const recordedOutput = path.join(
    layout.projectRoot,
    ...recordedOutputRelative.split("/"),
  );
  const samePhysicalOutput = samePhysicalSessionPath(
    recordedOutput,
    layout.publicOutputFile,
    "file",
  );
  if (
    record.publicOutputPath !== layout.publicOutputRelative &&
    !samePhysicalOutput
  ) {
    throw new Error(
      `this output was previously published as ${record.publicOutputPath}; use that original public output path instead of ${layout.publicOutputRelative}`,
    );
  }
  return record;
}

/** Encodes a v2 marker while preserving the accepted v1 generation facts. */
export function rootAcceptedGenerationBytes(
  layout: SessionLayout,
  accepted: Pick<
    LegacyAcceptedGenerationRecord,
    | "sessionNonce"
    | "generation"
    | "revision"
    | "acceptedAt"
    | "manifestDigest"
  >,
): string {
  return `${canonicalJson({
    protocol: "genes.tooling.accepted-generation.v2",
    sessionNonce: accepted.sessionNonce,
    generation: accepted.generation,
    revision: accepted.revision,
    acceptedAt: accepted.acceptedAt,
    manifestDigest: accepted.manifestDigest,
    publicOutputRoot: layout.publicOutputRootAuthority,
    publicOutputRootPath: layout.publicOutputRootRelative ?? ".",
    publicEntry: layout.publicEntryAuthority,
    publicEntryPath: layout.publicOutputRelative,
  })}\n`;
}

/** Encodes a root-owned generation that also records non-Genes files. */
export function acceptedGenerationBytes(
  layout: SessionLayout,
  accepted: Pick<
    LegacyAcceptedGenerationRecord,
    | "sessionNonce"
    | "generation"
    | "revision"
    | "acceptedAt"
    | "manifestDigest"
  >,
  supplementalFiles: readonly PublishedSupplementalFile[],
): string {
  return `${canonicalJson({
    protocol: "genes.tooling.accepted-generation.v4",
    sessionNonce: accepted.sessionNonce,
    generation: accepted.generation,
    revision: accepted.revision,
    acceptedAt: accepted.acceptedAt,
    manifestDigest: accepted.manifestDigest,
    publicOutputRoot: layout.publicOutputRootAuthority,
    publicOutputRootPath: layout.publicOutputRootRelative ?? ".",
    publicEntry: layout.publicEntryAuthority,
    publicEntryPath: layout.publicOutputRelative,
    supplementalFiles: supplementalFiles.map((file) => ({
      source: file.source,
      path: file.path,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      mode: file.mode,
    })),
  })}\n`;
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
    return Object.freeze({
      format: "absent",
      manifestDigest: null,
      accepted: null,
      state: ABSENT,
      supplementalFiles: Object.freeze([]),
    });
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
  const protocol = record.protocol;
  const v2 = protocol === "genes.tooling.accepted-generation.v2";
  const v3 = protocol === "genes.tooling.accepted-generation.v3";
  const v4 = protocol === "genes.tooling.accepted-generation.v4";
  const expectedKeys = v2
    ? "acceptedAt,generation,manifestDigest,protocol,publicEntry,publicEntryPath,publicOutputRoot,publicOutputRootPath,revision,sessionNonce"
    : "acceptedAt,generation,manifestDigest,protocol,publicEntry,publicEntryPath,publicOutputRoot,publicOutputRootPath,revision,sessionNonce,supplementalFiles";
  if (
    (!v2 && !v3 && !v4) ||
    Object.keys(record).sort().join(",") !== expectedKeys ||
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
    record.publicOutputRoot !== layout.publicOutputRootAuthority ||
    record.publicEntry !== layout.publicEntryAuthority ||
    typeof record.publicOutputRootPath !== "string" ||
    typeof record.publicEntryPath !== "string" ||
    `${canonicalJson(record as CanonicalJson)}\n` !== bytes
  ) {
    throw new Error("accepted-generation marker is invalid or non-canonical");
  }
  const recordedOutput = path.join(
    layout.projectRoot,
    ...validatePortableRelativePath(
      record.publicEntryPath as string,
      "accepted-generation publicEntryPath",
    ).split("/"),
  );
  const currentOutput = path.join(
    layout.projectRoot,
    ...layout.publicOutputRelative.split("/"),
  );
  const samePhysicalOutput = samePhysicalSessionPath(
    recordedOutput,
    currentOutput,
    "file",
  );
  const recordedRoot = path.join(
    layout.projectRoot,
    ...(
      record.publicOutputRootPath === "."
        ? []
        : validatePortableRelativePath(
            record.publicOutputRootPath as string,
            "accepted-generation publicOutputRootPath",
          ).split("/")
    ),
  );
  const currentRoot = layout.publicOutputRoot;
  const samePhysicalRoot = samePhysicalSessionPath(
    recordedRoot,
    currentRoot,
    "directory",
  );
  const recordedRootAuthority =
    record.publicOutputRootPath === "."
      ? "project-root:."
      : `project-relative:${portablePathIdentity(
          record.publicOutputRootPath as string,
        )}`;
  if (
    portablePathIdentity(record.publicEntryPath as string) !==
      record.publicEntry ||
    recordedRootAuthority !== record.publicOutputRoot
  ) {
    throw new Error("accepted-generation marker has an invalid path identity");
  }
  if (
    record.publicOutputRootPath !== (layout.publicOutputRootRelative ?? ".") &&
    !samePhysicalRoot
  ) {
    throw new Error("public output root spelling differs from its recorded owner");
  }
  if (
    record.publicEntryPath !== layout.publicOutputRelative &&
    !samePhysicalOutput
  ) {
    throw new Error(
      `this output was previously published as ${record.publicEntryPath}; use that original public output path instead of ${layout.publicOutputRelative}`,
    );
  }
  const markerState = readFileState(
    layout.projectRoot,
    layout.generationMarkerRelative,
    "unexpected-live-state",
  );
  const supplementalFiles = v2
    ? Object.freeze([])
    : parseSupplementalFiles(record.supplementalFiles, v3 ? "v3" : "v4");
  for (const file of supplementalFiles) {
    const absolute = path.join(layout.projectRoot, ...file.path.split("/"));
    if (
      portableProjectPathsOverlap(
        layout.projectRoot,
        absolute,
        layout.stateRoot,
      ) ||
      portableProjectPathsOverlap(
        layout.projectRoot,
        absolute,
        layout.stableControlRoot,
      )
    ) {
      throw new Error(
        `accepted supplemental file overlaps private state or stable session-control files: ${file.path}`,
      );
    }
  }
  return Object.freeze({
    format: v2 ? "v2" : v3 ? "v3" : "v4",
    manifestDigest: record.manifestDigest,
    accepted: Object.freeze({
      generation: record.generation as number,
      revision: record.revision as number,
      acceptedAt: record.acceptedAt as number,
    }),
    state: markerState,
    supplementalFiles,
  });
}

/**
 * Rebuilds the exact admission identities that may match an interrupted
 * publication.
 *
 * A v2 marker names only the Genes output tree. The older v3 marker names
 * extra files but not the step that produced them. V4 records that missing
 * fact. When no marker exists yet, recovery may be finishing any format, so
 * every empty-file identity remains valid.
 */
export function recoveredAdmissionDigests(
  layout: SessionLayout,
  manifestDigest: string,
  validatorPolicyFacts: JsonValue,
  marker: PublishedMarker,
): readonly string[] {
  if (marker.format === "v4") {
    return Object.freeze([
      admissionDigest(
        layout,
        manifestDigest,
        validatorPolicyFacts,
        marker.supplementalFiles,
      ),
      v4AdmissionDigest(
        layout,
        manifestDigest,
        validatorPolicyFacts,
        marker.supplementalFiles,
      ),
    ]);
  }
  if (marker.format === "v3") {
    return Object.freeze([
      legacySupplementalAdmissionDigest(
        layout,
        manifestDigest,
        validatorPolicyFacts,
        marker.supplementalFiles,
      ),
    ]);
  }
  const v2 = rootAdmissionDigest(
    layout,
    manifestDigest,
    validatorPolicyFacts,
  );
  if (marker.format === "v2") return Object.freeze([v2]);
  return Object.freeze([
    admissionDigest(layout, manifestDigest, validatorPolicyFacts),
    v4AdmissionDigest(layout, manifestDigest, validatorPolicyFacts),
    legacySupplementalAdmissionDigest(
      layout,
      manifestDigest,
      validatorPolicyFacts,
      Object.freeze([]),
    ),
    v2,
  ]);
}

/** Classifies one interrupted admission without recreating private data. */
export function recoveredAdmissionMode(
  layout: SessionLayout,
  manifestDigest: string,
  validatorPolicyFacts: JsonValue,
  marker: PublishedMarker,
  authorizationDigest: string,
): AdmissionRecoveryMode | null {
  if (
    authorizationDigest ===
    admissionDigest(
      layout,
      manifestDigest,
      validatorPolicyFacts,
      marker.supplementalFiles,
      "rebuild-required",
    )
  ) {
    return "rebuild-required";
  }
  return recoveredAdmissionDigests(
    layout,
    manifestDigest,
    validatorPolicyFacts,
    marker,
  ).includes(authorizationDigest)
    ? "replayable"
    : null;
}

/**
 * Records an exact live tree from an older host without rewriting that tree.
 *
 * Every generated and supplemental file appears as an unchanged transition.
 * The only new public byte is DevelopmentSession's commit marker.
 */
export function prepareExistingGenerationImport(
  layout: SessionLayout,
  stageRelativePath: string,
  live: GenesOutputInventory,
  supplementalFiles: readonly PublishedSupplementalFile[],
  acceptedAt: number,
  validatorPolicyFacts: JsonValue,
  sessionNonce: string,
): PreparedPublication {
  const accepted: AcceptedGeneration = Object.freeze({
    generation: 1,
    revision: 1,
    acceptedAt,
    manifestDigest: live.manifestDigest,
    compilerMode: "external",
    files: Object.freeze({
      created: Object.freeze([]),
      updated: Object.freeze([]),
      deleted: Object.freeze([]),
    }),
    entryChanged: false,
  });
  const artifacts: PublicationPlan["artifacts"][number][] = [
    ...live.files.map((file) => {
      const exact = state(file);
      return Object.freeze({
        path: logicalOutputPath(layout, file.relativePath),
        prior: exact,
        next: exact,
        stagedPath: null,
      });
    }),
    (() => {
      const exact = state(live.manifestFile);
      return Object.freeze({
        path: logicalOutputPath(layout, live.manifestName),
        prior: exact,
        next: exact,
        stagedPath: null,
      });
    })(),
    ...supplementalFiles.map((file) => {
      const exact: ExpectedFileState = Object.freeze({
        kind: "file",
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        mode: file.mode,
      });
      return Object.freeze({
        path: file.path,
        prior: exact,
        next: exact,
        stagedPath: null,
      });
    }),
  ];
  const identities = new Map<string, string>();
  for (const artifact of artifacts) {
    const identity = portablePathIdentity(artifact.path);
    const previous = identities.get(identity);
    if (previous !== undefined) {
      throw new Error(
        `existing generation files collide by path: ${previous} and ${artifact.path}`,
      );
    }
    identities.set(identity, artifact.path);
  }
  for (const [identity, artifactPath] of identities) {
    let ancestor = identity;
    while (ancestor.includes("/")) {
      ancestor = ancestor.slice(0, ancestor.lastIndexOf("/"));
      const previous = identities.get(ancestor);
      if (previous !== undefined) {
        throw new Error(
          `existing generation file overlaps another file: ${previous} and ${artifactPath}`,
        );
      }
    }
  }
  artifacts.sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)),
  );

  const markerStageRelative = `${stageRelativePath}/generation.json`;
  const markerAbsolute = path.join(
    layout.projectRoot,
    ...markerStageRelative.split("/"),
  );
  mkdirSync(path.dirname(markerAbsolute), { recursive: true, mode: 0o700 });
  const marker = acceptedGenerationBytes(
    layout,
    {
      sessionNonce,
      generation: accepted.generation,
      revision: accepted.revision,
      acceptedAt: accepted.acceptedAt,
      manifestDigest: accepted.manifestDigest,
    },
    supplementalFiles,
  );
  writeFileSync(markerAbsolute, marker, { mode: 0o600 });
  chmodSync(markerAbsolute, 0o600);
  const authorization = admissionDigest(
    layout,
    live.manifestDigest,
    validatorPolicyFacts,
    supplementalFiles,
  );
  return Object.freeze({
    accepted,
    plan: Object.freeze({
      protocol: ARTIFACT_PLAN_PROTOCOL,
      version: ARTIFACT_PLAN_VERSION,
      projectIdentity: sessionProjectDigest(layout),
      authorizationDigest: authorization,
      transactionRoot: layout.transactionRelative,
      stageRoot: stageRelativePath,
      artifacts: Object.freeze(artifacts),
      commitMarker: Object.freeze({
        path: layout.generationMarkerRelative,
        prior: ABSENT,
        next: Object.freeze({
          kind: "file" as const,
          sha256: sha256Bytes(marker),
          sizeBytes: Buffer.byteLength(marker),
          mode: 0o600,
        }),
        stagedPath: markerStageRelative,
      }),
    }),
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
  supplementalFiles: readonly SupplementalFile[],
  priorSupplementalFiles: readonly PublishedSupplementalFile[],
  recoveryMode: AdmissionRecoveryMode = "replayable",
): PreparedPublication {
  const publishedSupplemental = Object.freeze(
    [...supplementalFiles].sort((left, right) =>
      Buffer.from(left.path).compare(Buffer.from(right.path)),
    ),
  );
  const candidateSupplementalIdentities = new Set(
    publishedSupplemental.map((file) => portablePathIdentity(file.path)),
  );
  if (candidateSupplementalIdentities.size !== publishedSupplemental.length) {
    throw new Error("prepared and admitted artifacts collide by portable path");
  }
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

  const supplementalByPath = new Map(
    publishedSupplemental.map((file) =>
      [portablePathIdentity(file.path), file] as const,
    ),
  );
  const priorSupplementalByPath = new Map(
    priorSupplementalFiles.map((file) =>
      [portablePathIdentity(file.path), file] as const,
    ),
  );
  for (const [identity, next] of supplementalByPath) {
    const previous = priorSupplementalByPath.get(identity);
    if (previous !== undefined && previous.path !== next.path) {
      throw new Error(
        `supplemental file path spelling changed: ${previous.path} and ${next.path}`,
      );
    }
  }
  const supplementalIdentities = bytewise(
    new Set([...supplementalByPath.keys(), ...priorSupplementalByPath.keys()]),
  );
  for (const identity of supplementalIdentities) {
    const next = supplementalByPath.get(identity);
    const previous = priorSupplementalByPath.get(identity);
    const livePath = next?.path ?? previous!.path;
    const priorState: ExpectedFileState = previous === undefined
      ? ABSENT
      : Object.freeze({
          kind: "file" as const,
          sha256: previous.sha256,
          sizeBytes: previous.sizeBytes,
          mode: previous.mode,
        });
    const nextState: ExpectedFileState = next === undefined
      ? ABSENT
      : supplementalState(next);
    const changes = !sameFileState(priorState, nextState);
    if (!changes && next !== undefined) {
      rmSync(next.absolutePath, { force: true });
    }
    artifacts.push({
      path: livePath,
      prior: priorState,
      next: nextState,
      stagedPath: changes && next !== undefined ? next.stagedPath : null,
    });
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

  const artifactIdentities = new Map<string, string>();
  for (const artifact of artifacts) {
    const identity = portablePathIdentity(artifact.path);
    const previous = artifactIdentities.get(identity);
    if (previous !== undefined) {
      throw new Error(
        `prepared or admitted artifact collides with generated output: ${previous} and ${artifact.path}`,
      );
    }
    artifactIdentities.set(identity, artifact.path);
  }
  for (const [identity, artifactPath] of artifactIdentities) {
    let ancestor = identity;
    while (ancestor.includes("/")) {
      ancestor = ancestor.slice(0, ancestor.lastIndexOf("/"));
      const previous = artifactIdentities.get(ancestor);
      if (previous !== undefined) {
        throw new Error(
          `prepared or admitted artifact collides with generated output: ${previous} and ${artifactPath}`,
        );
      }
    }
  }

  artifacts.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const markerStageRelative = `${candidateStageRelative}/generation.json`;
  const markerAbsolute = path.join(
    layout.projectRoot,
    ...markerStageRelative.split("/"),
  );
  mkdirSync(path.dirname(markerAbsolute), { recursive: true, mode: 0o700 });
  const marker = acceptedGenerationBytes(
    layout,
    {
      sessionNonce,
      generation,
      revision,
      acceptedAt,
      manifestDigest: candidate.manifestDigest,
    },
    publishedSupplemental.map((file) => ({
      source: file.source,
      path: file.path,
      sha256: file.digest,
      sizeBytes: file.sizeBytes,
      mode: file.mode,
    })),
  );
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
    publishedSupplemental.map((file) => ({
      source: file.source,
      path: file.path,
      sha256: file.digest,
      sizeBytes: file.sizeBytes,
      mode: file.mode,
    })),
    recoveryMode,
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
