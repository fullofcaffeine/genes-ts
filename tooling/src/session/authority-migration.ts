import {
  chmodSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";

import {
  ARTIFACT_PLAN_PROTOCOL,
  ARTIFACT_PLAN_VERSION,
  canonicalDigest,
  canonicalJson,
  sha256Bytes,
  type ArtifactCheckpoint,
  type CanonicalJson,
  type ExpectedFileState,
  type PublicationPlan,
  type PublicationOutcome,
  type RecoveryOutcome,
} from "../artifacts/index.js";
import {
  ensureDirectoryNoFollow,
  lstatPresent,
  readFileState,
  removeTreeNoFollow,
  sameFileState,
  writeDurableFile,
} from "../artifacts/filesystem.js";
import {
  portablePathIdentity,
  validatePortableRelativePath,
} from "../artifacts/validate-plan.js";
import { readGenesOutput } from "./genes-output.js";
import {
  materializeSessionAuthorityLayout,
  type SessionLayout,
} from "./layout.js";
import {
  parseLegacyAcceptedGeneration,
  readPublishedMarker,
  rootAcceptedGenerationBytes,
  sessionProjectDigest,
  type LegacyAcceptedGenerationRecord,
} from "./publication.js";
import {
  claimSessionRootOwner,
  sessionRootOwnerBytes,
} from "./session-lock.js";

const RECEIPT_PROTOCOL =
  "genes.tooling.development-session-authority-migration.v1" as const;
/**
 * A fence replaces the older accepted marker with a record that old tooling
 * does not understand. That makes an old process stop safely instead of
 * publishing after this project has moved to root-scoped ownership.
 */
const FENCE_PROTOCOL =
  "genes.tooling.development-session-legacy-fence.v1" as const;
const ABSENT = Object.freeze({ kind: "absent" as const });

type MigrationStep = "receipt" | "fence" | "owner" | "root-marker";

export type AuthorityMigrationCheckpoint =
  | `during-${MigrationStep}:${ArtifactCheckpoint}`
  | `after-${MigrationStep}`;

export interface AuthorityMigrationOptions {
  readonly publish: (options: {
    readonly projectRoot: string;
    readonly plan: PublicationPlan;
    readonly admitIntended?: (
      plan: PublicationPlan,
    ) => boolean | Promise<boolean>;
    readonly faultInjector?: (checkpoint: ArtifactCheckpoint) => void;
  }) => Promise<PublicationOutcome>;
  readonly recover: (options: {
    readonly projectRoot: string;
    readonly transactionRoot: string;
    readonly projectIdentity: string;
    readonly admitIntended: (
      plan: PublicationPlan,
    ) => boolean | Promise<boolean>;
  }) => Promise<RecoveryOutcome>;
  readonly faultInjector?: (checkpoint: AuthorityMigrationCheckpoint) => void;
}

interface MigrationReceipt {
  readonly protocol: typeof RECEIPT_PROTOCOL;
  readonly migrationId: string;
  readonly projectIdentity: string;
  readonly publicOutputRoot: string;
  readonly publicOutputRootPath: string;
  readonly publicEntry: string;
  readonly publicEntryPath: string;
  readonly legacyMarkerPath: string;
  readonly legacyMarkerState: ExpectedFileState;
  readonly legacyAccepted: LegacyAcceptedGenerationRecord;
  readonly liveManifestDigest: string;
  readonly fenceSha256: string;
  readonly rootOwnerSha256: string;
  readonly rootMarkerSha256: string;
}

interface MigrationEvidence {
  readonly receipt: MigrationReceipt;
  readonly receiptBytes: string;
  readonly fenceBytes: string;
  readonly ownerBytes: string;
  readonly rootMarkerBytes: string;
}

function fileState(bytes: string): ExpectedFileState {
  return Object.freeze({
    kind: "file" as const,
    sha256: sha256Bytes(bytes),
    sizeBytes: Buffer.byteLength(bytes),
    mode: 0o600,
  });
}

function exactFile(
  layout: SessionLayout,
  relative: string,
  label: string,
): { readonly bytes: string; readonly state: ExpectedFileState } | null {
  const absolute = path.join(layout.projectRoot, ...relative.split("/"));
  const stats = lstatPresent(absolute);
  if (stats === null) return null;
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} is not a real file`);
  }
  return Object.freeze({
    bytes: readFileSync(absolute, "utf8"),
    state: readFileState(
      layout.projectRoot,
      relative,
      "unexpected-live-state",
    ),
  });
}

function fenceBytes(
  layout: SessionLayout,
  migrationId: string,
  legacyMarkerSha256: string,
): string {
  return `${canonicalJson({
    protocol: FENCE_PROTOCOL,
    migrationId,
    receiptPath: layout.authorityMigrationReceiptRelative,
    publicOutputRoot: layout.publicOutputRootAuthority,
    publicEntry: layout.publicEntryAuthority,
    legacyMarkerSha256,
  })}\n`;
}

function buildEvidenceForManifest(
  layout: SessionLayout,
  legacyAccepted: LegacyAcceptedGenerationRecord,
  legacyMarkerState: ExpectedFileState,
  liveManifestDigest: string,
): MigrationEvidence {
  if (legacyMarkerState.kind !== "file") {
    throw new Error("legacy migration requires an exact marker file state");
  }
  if (liveManifestDigest !== legacyAccepted.manifestDigest) {
    throw new Error(
      "legacy accepted generation does not match the live Genes ownership manifest",
    );
  }
  const migrationId = canonicalDigest({
    protocol: "genes.tooling.development-session-authority-migration-basis.v1",
    projectIdentity: layout.projectIdentity,
    publicOutputRoot: layout.publicOutputRootAuthority,
    publicEntry: layout.publicEntryAuthority,
    legacyMarkerState,
    legacyAccepted,
    liveManifestDigest,
  } as unknown as CanonicalJson);
  const nextFenceBytes = fenceBytes(
    layout,
    migrationId,
    legacyMarkerState.sha256,
  );
  const ownerBytes = sessionRootOwnerBytes(layout);
  const rootMarkerBytes = rootAcceptedGenerationBytes(layout, legacyAccepted);
  const receipt: MigrationReceipt = Object.freeze({
    protocol: RECEIPT_PROTOCOL,
    migrationId,
    projectIdentity: layout.projectIdentity,
    publicOutputRoot: layout.publicOutputRootAuthority,
    publicOutputRootPath: layout.publicOutputRootRelative ?? ".",
    publicEntry: layout.publicEntryAuthority,
    publicEntryPath: layout.publicOutputRelative,
    legacyMarkerPath: layout.legacyGenerationMarkerRelative,
    legacyMarkerState,
    legacyAccepted,
    liveManifestDigest,
    fenceSha256: sha256Bytes(nextFenceBytes),
    rootOwnerSha256: sha256Bytes(ownerBytes),
    rootMarkerSha256: sha256Bytes(rootMarkerBytes),
  });
  const receiptBytes = `${canonicalJson(receipt as unknown as CanonicalJson)}\n`;
  return Object.freeze({
    receipt,
    receiptBytes,
    fenceBytes: nextFenceBytes,
    ownerBytes,
    rootMarkerBytes,
  });
}

function buildEvidence(
  layout: SessionLayout,
  legacyAccepted: LegacyAcceptedGenerationRecord,
  legacyMarkerState: ExpectedFileState,
): MigrationEvidence {
  const live = readGenesOutput(
    layout.publicOutputRoot,
    layout.outputIdentity,
    true,
  );
  if (live === null) {
    throw new Error(
      "legacy accepted generation has no live Genes ownership manifest",
    );
  }
  return buildEvidenceForManifest(
    layout,
    legacyAccepted,
    legacyMarkerState,
    live.manifestDigest,
  );
}

function parseReceipt(layout: SessionLayout, bytes: string): MigrationEvidence {
  let decoded: unknown;
  try {
    decoded = JSON.parse(bytes);
  } catch {
    throw new Error("authority migration receipt is not valid JSON");
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw new Error("authority migration receipt is not an object");
  }
  const fields = decoded as Record<string, unknown>;
  if (
    Object.keys(fields).sort().join(",") !==
      "fenceSha256,legacyAccepted,legacyMarkerPath,legacyMarkerState,liveManifestDigest,migrationId,projectIdentity,protocol,publicEntry,publicEntryPath,publicOutputRoot,publicOutputRootPath,rootMarkerSha256,rootOwnerSha256" ||
    fields.protocol !== RECEIPT_PROTOCOL ||
    typeof fields.legacyAccepted !== "object" ||
    fields.legacyAccepted === null ||
    Array.isArray(fields.legacyAccepted) ||
    typeof fields.legacyMarkerState !== "object" ||
    fields.legacyMarkerState === null ||
    Array.isArray(fields.legacyMarkerState)
  ) {
    throw new Error("authority migration receipt has an invalid shape");
  }
  const legacyBytes = `${canonicalJson(
    fields.legacyAccepted as CanonicalJson,
  )}\n`;
  const legacyAccepted = parseLegacyAcceptedGeneration(layout, legacyBytes);
  const stateFields = fields.legacyMarkerState as Record<string, unknown>;
  if (
    Object.keys(stateFields).sort().join(",") !== "kind,mode,sha256,sizeBytes" ||
    stateFields.kind !== "file" ||
    typeof stateFields.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(stateFields.sha256) ||
    !Number.isInteger(stateFields.sizeBytes) ||
    (stateFields.sizeBytes as number) < 0 ||
    !Number.isInteger(stateFields.mode) ||
    (stateFields.mode as number) < 0
  ) {
    throw new Error("authority migration receipt has an invalid marker state");
  }
  if (
    typeof fields.liveManifestDigest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(fields.liveManifestDigest)
  ) {
    throw new Error("authority migration receipt has an invalid manifest digest");
  }
  const evidence = buildEvidenceForManifest(
    layout,
    legacyAccepted,
    Object.freeze({
      kind: "file" as const,
      sha256: stateFields.sha256,
      sizeBytes: stateFields.sizeBytes as number,
      mode: stateFields.mode as number,
    }),
    fields.liveManifestDigest,
  );
  if (evidence.receiptBytes !== bytes) {
    throw new Error("authority migration receipt is invalid or non-canonical");
  }
  return evidence;
}

function parseFence(layout: SessionLayout, bytes: string): void {
  let decoded: unknown;
  try {
    decoded = JSON.parse(bytes);
  } catch {
    throw new Error("legacy migration fence is not valid JSON");
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw new Error("legacy migration fence is not an object");
  }
  const fields = decoded as Record<string, unknown>;
  if (
    Object.keys(fields).sort().join(",") !==
      "legacyMarkerSha256,migrationId,protocol,publicEntry,publicOutputRoot,receiptPath" ||
    fields.protocol !== FENCE_PROTOCOL ||
    fields.publicOutputRoot !== layout.publicOutputRootAuthority ||
    fields.publicEntry !== layout.publicEntryAuthority ||
    fields.receiptPath !== layout.authorityMigrationReceiptRelative ||
    `${canonicalJson(fields as CanonicalJson)}\n` !== bytes
  ) {
    throw new Error("legacy migration fence is invalid or non-canonical");
  }
}

function migrationPlan(
  layout: SessionLayout,
  evidence: MigrationEvidence,
  step: MigrationStep,
  livePath: string,
  prior: ExpectedFileState,
  nextBytes: string,
): PublicationPlan {
  const base = layout.authorityMigrationRelative;
  const stageRoot = `${base}/stages/${step}`;
  const stagedPath = `${stageRoot}/next.json`;
  const next = fileState(nextBytes);
  const authorizationDigest = canonicalDigest({
    protocol: "genes.tooling.development-session-authority-migration-step.v1",
    migrationId: evidence.receipt.migrationId,
    step,
    livePath,
    prior,
    next,
  } as unknown as CanonicalJson);
  return Object.freeze({
    protocol: ARTIFACT_PLAN_PROTOCOL,
    version: ARTIFACT_PLAN_VERSION,
    projectIdentity: sessionProjectDigest(layout),
    authorizationDigest,
    transactionRoot: `${base}/transactions/${step}`,
    stageRoot,
    artifacts: Object.freeze([]),
    commitMarker: Object.freeze({
      path: livePath,
      prior,
      next,
      stagedPath,
    }),
  });
}

function stageExact(
  layout: SessionLayout,
  plan: PublicationPlan,
  bytes: string,
): void {
  const stagedPath = plan.commitMarker.stagedPath!;
  const stagedAbsolute = path.join(
    layout.projectRoot,
    ...stagedPath.split("/"),
  );
  ensureDirectoryNoFollow(layout.projectRoot, plan.stageRoot, 0o700);
  const existing = lstatPresent(stagedAbsolute);
  if (existing === null) {
    writeDurableFile(stagedAbsolute, bytes, 0o600, true);
    chmodSync(stagedAbsolute, 0o600);
    return;
  }
  if (
    existing.isSymbolicLink() ||
    !existing.isFile() ||
    readFileSync(stagedAbsolute, "utf8") !== bytes
  ) {
    throw new Error("authority migration staged bytes changed unexpectedly");
  }
}

async function publishStep(
  layout: SessionLayout,
  evidence: MigrationEvidence,
  options: AuthorityMigrationOptions,
  step: MigrationStep,
  livePath: string,
  prior: ExpectedFileState,
  nextBytes: string,
): Promise<void> {
  const plan = migrationPlan(
    layout,
    evidence,
    step,
    livePath,
    prior,
    nextBytes,
  );
  const isExpected = (candidate: PublicationPlan): boolean =>
    canonicalJson(candidate as unknown as CanonicalJson) ===
    canonicalJson(plan as unknown as CanonicalJson);
  await options.recover({
    projectRoot: layout.projectRoot,
    transactionRoot: plan.transactionRoot,
    projectIdentity: plan.projectIdentity,
    admitIntended: isExpected,
  });
  const live = readFileState(
    layout.projectRoot,
    livePath,
    "unexpected-live-state",
  );
  if (!sameFileState(live, plan.commitMarker.next)) {
    if (!sameFileState(live, prior)) {
      throw new Error(`authority migration ${step} state is contradictory`);
    }
    stageExact(layout, plan, nextBytes);
    await options.publish({
      projectRoot: layout.projectRoot,
      plan,
      admitIntended: isExpected,
      faultInjector: (checkpoint) =>
        options.faultInjector?.(`during-${step}:${checkpoint}`),
    });
  }
  const stageAbsolute = path.join(
    layout.projectRoot,
    ...plan.stageRoot.split("/"),
  );
  if (lstatPresent(stageAbsolute) !== null) removeTreeNoFollow(stageAbsolute);
  options.faultInjector?.(`after-${step}`);
}

function rootOwnerExists(layout: SessionLayout): boolean {
  const absolute = path.join(
    layout.projectRoot,
    ...layout.rootOwnerRelative.split("/"),
  );
  const stats = lstatPresent(absolute);
  if (stats === null) return false;
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("development session root owner is invalid");
  }
  return true;
}

function auditedRootAuthority(publicEntryPath: string): string {
  const validated = validatePortableRelativePath(
    publicEntryPath,
    "legacy accepted-generation publicOutputPath",
  );
  const parent = path.posix.dirname(validated);
  return parent === "."
    ? "project-root:."
    : `project-relative:${portablePathIdentity(parent)}`;
}

/** Refuses to guess when two older entries both claim one output directory. */
export function auditSessionAuthority(layout: SessionLayout): void {
  const controlRelative = ".genes/tooling/session-publications";
  const controlAbsolute = path.join(
    layout.projectRoot,
    ...controlRelative.split("/"),
  );
  const controlStats = lstatPresent(controlAbsolute);
  if (controlStats === null) return;
  if (controlStats.isSymbolicLink() || !controlStats.isDirectory()) {
    throw new Error("development-session publication control root is invalid");
  }
  for (const entry of readdirSync(controlAbsolute, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error("development-session publication control scope is invalid");
    }
    const marker = path.join(
      controlAbsolute,
      entry.name,
      "accepted-generation.json",
    );
    const markerStats = lstatPresent(marker);
    if (markerStats === null) continue;
    if (markerStats.isSymbolicLink() || !markerStats.isFile()) {
      throw new Error("accepted-generation control marker is invalid");
    }
    const bytes = readFileSync(marker, "utf8");
    let decoded: unknown;
    try {
      decoded = JSON.parse(bytes);
    } catch {
      throw new Error("accepted-generation control namespace cannot be audited");
    }
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      Array.isArray(decoded) ||
      `${canonicalJson(decoded as CanonicalJson)}\n` !== bytes
    ) {
      throw new Error("accepted-generation control namespace cannot be audited");
    }
    const fields = decoded as Record<string, unknown>;
    let rootAuthority: string;
    let entryAuthority: string;
    let expectedScope: string;
    if (fields.protocol === "genes.tooling.accepted-generation.v1") {
      if (
        typeof fields.publicOutput !== "string" ||
        typeof fields.publicOutputPath !== "string" ||
        portablePathIdentity(fields.publicOutputPath) !== fields.publicOutput
      ) {
        throw new Error("legacy accepted-generation control is invalid");
      }
      rootAuthority = auditedRootAuthority(fields.publicOutputPath);
      entryAuthority = fields.publicOutput;
      expectedScope = sha256Bytes(entryAuthority);
    } else if (fields.protocol === FENCE_PROTOCOL) {
      if (
        typeof fields.publicOutputRoot !== "string" ||
        typeof fields.publicEntry !== "string"
      ) {
        throw new Error("legacy migration fence control is invalid");
      }
      rootAuthority = fields.publicOutputRoot;
      entryAuthority = fields.publicEntry;
      expectedScope = sha256Bytes(entryAuthority);
    } else if (fields.protocol === "genes.tooling.accepted-generation.v2") {
      if (
        typeof fields.publicOutputRoot !== "string" ||
        typeof fields.publicEntry !== "string"
      ) {
        throw new Error("root accepted-generation control is invalid");
      }
      rootAuthority = fields.publicOutputRoot;
      entryAuthority = fields.publicEntry;
      expectedScope = sha256Bytes(rootAuthority);
    } else {
      throw new Error("accepted-generation control protocol is unknown");
    }
    if (entry.name !== expectedScope) {
      throw new Error("accepted-generation control is stored in the wrong scope");
    }
    if (
      rootAuthority === layout.publicOutputRootAuthority &&
      entryAuthority !== layout.publicEntryAuthority
    ) {
      throw new Error(
        "public output root has contradictory legacy entry authorities",
      );
    }
  }
}

/**
 * Upgrades older, entry-scoped session records to one owner for the complete
 * output directory. Here, "authority" means the exact lock, owner, journal,
 * and marker files that permit publication or crash recovery. Both old and
 * new locks are held, and each changed record uses the normal recoverable
 * artifact writer, so a stopped process can continue safely on restart.
 */
export async function establishSessionAuthority(
  layout: SessionLayout,
  options: AuthorityMigrationOptions,
): Promise<void> {
  materializeSessionAuthorityLayout(layout);
  auditSessionAuthority(layout);
  const receiptFile = exactFile(
    layout,
    layout.authorityMigrationReceiptRelative,
    "authority migration receipt",
  );
  const legacyFile = exactFile(
    layout,
    layout.legacyGenerationMarkerRelative,
    "legacy accepted-generation marker",
  );
  const rootMarker = readPublishedMarker(layout);

  let evidence: MigrationEvidence | null =
    receiptFile === null ? null : parseReceipt(layout, receiptFile.bytes);
  if (evidence === null && legacyFile !== null) {
    const accepted = parseLegacyAcceptedGeneration(layout, legacyFile.bytes);
    if (rootMarker.manifestDigest !== null) {
      throw new Error(
        "root and unfenced legacy accepted generations coexist",
      );
    }
    evidence = buildEvidence(layout, accepted, legacyFile.state);
  }

  if (evidence === null) {
    if (rootMarker.manifestDigest !== null && !rootOwnerExists(layout)) {
      throw new Error("root accepted generation has no durable root owner");
    }
    claimSessionRootOwner(layout);
    return;
  }

  await publishStep(
    layout,
    evidence,
    options,
    "receipt",
    layout.authorityMigrationReceiptRelative,
    ABSENT,
    evidence.receiptBytes,
  );

  if (rootMarker.manifestDigest !== null) {
    const currentLegacy = exactFile(
      layout,
      layout.legacyGenerationMarkerRelative,
      "legacy accepted-generation marker",
    );
    if (currentLegacy === null) {
      throw new Error("root accepted generation has no legacy migration fence");
    }
    parseFence(layout, currentLegacy.bytes);
    if (currentLegacy.bytes !== evidence.fenceBytes) {
      throw new Error("root and unfenced legacy accepted generations coexist");
    }
    const currentOwner = exactFile(
      layout,
      layout.rootOwnerRelative,
      "development session root owner",
    );
    if (currentOwner === null || currentOwner.bytes !== evidence.ownerBytes) {
      throw new Error("root accepted generation has no durable root owner");
    }
    const currentRootMarker = exactFile(
      layout,
      layout.generationMarkerRelative,
      "root accepted-generation marker",
    );
    if (currentRootMarker === null) {
      throw new Error("root accepted generation disappeared during migration");
    }
    if (currentRootMarker.bytes === evidence.rootMarkerBytes) {
      // A process can stop after the atomic file move but before the artifact
      // journal is removed. Reopen every deterministic step before treating
      // the translated marker as complete migration authority.
      await publishStep(
        layout,
        evidence,
        options,
        "fence",
        layout.legacyGenerationMarkerRelative,
        evidence.receipt.legacyMarkerState,
        evidence.fenceBytes,
      );
      await publishStep(
        layout,
        evidence,
        options,
        "owner",
        layout.rootOwnerRelative,
        ABSENT,
        evidence.ownerBytes,
      );
      await publishStep(
        layout,
        evidence,
        options,
        "root-marker",
        layout.generationMarkerRelative,
        ABSENT,
        evidence.rootMarkerBytes,
      );
    }
    claimSessionRootOwner(layout);
    return;
  }

  const migrationLive = readGenesOutput(
    layout.publicOutputRoot,
    layout.outputIdentity,
    true,
  );
  if (
    migrationLive === null ||
    migrationLive.manifestDigest !== evidence.receipt.liveManifestDigest
  ) {
    throw new Error(
      "public output changed before authority migration completed",
    );
  }

  // Recover the fence transaction before inspecting its public path. During
  // an atomic replacement, a stopped process can leave the old marker in the
  // journal backup and the public path temporarily absent.
  await publishStep(
    layout,
    evidence,
    options,
    "fence",
    layout.legacyGenerationMarkerRelative,
    evidence.receipt.legacyMarkerState,
    evidence.fenceBytes,
  );
  const currentLegacy = exactFile(
    layout,
    layout.legacyGenerationMarkerRelative,
    "legacy accepted-generation marker",
  );
  if (currentLegacy === null) {
    throw new Error("legacy migration fence disappeared after recovery");
  }
  parseFence(layout, currentLegacy.bytes);
  if (currentLegacy.bytes !== evidence.fenceBytes) {
    throw new Error("legacy migration fence does not match its receipt");
  }
  await publishStep(
    layout,
    evidence,
    options,
    "owner",
    layout.rootOwnerRelative,
    ABSENT,
    evidence.ownerBytes,
  );
  await publishStep(
    layout,
    evidence,
    options,
    "root-marker",
    layout.generationMarkerRelative,
    ABSENT,
    evidence.rootMarkerBytes,
  );

  claimSessionRootOwner(layout);
  const migrated = readPublishedMarker(layout);
  if (migrated.manifestDigest !== evidence.receipt.liveManifestDigest) {
    throw new Error("translated root accepted generation is invalid");
  }
}
