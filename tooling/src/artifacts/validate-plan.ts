import { artifactFailure } from "./error.js";
import type {
  ArtifactTransition,
  ExpectedFileState,
  PortableRelativePath,
  PublicationPlan,
} from "./types.js";
import {
  ARTIFACT_PLAN_PROTOCOL,
  ARTIFACT_PLAN_VERSION,
} from "./types.js";

const SHA256 = /^[0-9a-f]{64}$/;
const WINDOWS_RESERVED =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function validateDigest(value: string, subject: string): void {
  if (!SHA256.test(value)) {
    artifactFailure("invalid-plan", subject);
  }
}

export function validatePortableRelativePath(
  value: string,
  subject = value,
): PortableRelativePath {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.normalize("NFC") !== value
  ) {
    artifactFailure("path-escape", subject);
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(" ") ||
        segment.endsWith(".") ||
        /[<>:"|?*\u0001-\u001f]/u.test(segment) ||
        WINDOWS_RESERVED.test(segment),
    )
  ) {
    artifactFailure("path-escape", subject);
  }
  return value;
}

function portableIdentity(value: PortableRelativePath): string {
  return value.normalize("NFC").toLowerCase();
}

function isWithin(
  root: PortableRelativePath,
  candidate: PortableRelativePath,
): boolean {
  const portableRoot = portableIdentity(root);
  const portableCandidate = portableIdentity(candidate);
  return (
    portableCandidate === portableRoot ||
    portableCandidate.startsWith(`${portableRoot}/`)
  );
}

function sameState(
  left: ExpectedFileState,
  right: ExpectedFileState,
): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === "absent" ||
      (right.kind === "file" &&
        left.sha256 === right.sha256 &&
        left.sizeBytes === right.sizeBytes &&
        left.mode === right.mode))
  );
}

function validateState(state: ExpectedFileState, subject: string): void {
  if (state.kind === "absent") {
    if (Object.keys(state).length !== 1) {
      artifactFailure("invalid-plan", subject);
    }
    return;
  }
  if (
    state.kind !== "file" ||
    Object.keys(state).sort().join(",") !== "kind,mode,sha256,sizeBytes" ||
    !Number.isSafeInteger(state.sizeBytes) ||
    state.sizeBytes < 0 ||
    !Number.isInteger(state.mode) ||
    state.mode < 0 ||
    state.mode > 0o777
  ) {
    artifactFailure("invalid-plan", subject);
  }
  validateDigest(state.sha256, `${subject}.sha256`);
}

function validateTransition(
  transition: ArtifactTransition,
  subject: string,
  stageRoot: PortableRelativePath,
): void {
  if (
    Object.keys(transition).sort().join(",") !==
    "next,path,prior,stagedPath"
  ) {
    artifactFailure("invalid-plan", subject);
  }
  validatePortableRelativePath(transition.path);
  validateState(transition.prior, `${subject}.prior`);
  validateState(transition.next, `${subject}.next`);
  const changes = !sameState(transition.prior, transition.next);
  if (transition.next.kind === "file" && changes) {
    if (transition.stagedPath === null) {
      artifactFailure("invalid-plan", transition.path);
    }
    validatePortableRelativePath(transition.stagedPath);
    if (
      portableIdentity(transition.stagedPath) ===
        portableIdentity(stageRoot) ||
      !isWithin(stageRoot, transition.stagedPath)
    ) {
      artifactFailure("invalid-plan", transition.path);
    }
  } else if (transition.stagedPath !== null) {
    artifactFailure("invalid-plan", transition.path);
  }
}

export function validatePublicationPlan(plan: PublicationPlan): PublicationPlan {
  if (
    Object.keys(plan).sort().join(",") !==
    "artifacts,authorizationDigest,commitMarker,projectIdentity,protocol,stageRoot,transactionRoot,version"
  ) {
    artifactFailure("invalid-plan", "$");
  }
  if (
    plan.protocol !== ARTIFACT_PLAN_PROTOCOL ||
    plan.version !== ARTIFACT_PLAN_VERSION
  ) {
    artifactFailure("invalid-plan", "$.protocol");
  }
  validateDigest(plan.projectIdentity, "$.projectIdentity");
  validateDigest(plan.authorizationDigest, "$.authorizationDigest");
  const transactionRoot = validatePortableRelativePath(
    plan.transactionRoot,
    "$.transactionRoot",
  );
  const stageRoot = validatePortableRelativePath(plan.stageRoot, "$.stageRoot");
  if (
    isWithin(transactionRoot, stageRoot) ||
    isWithin(stageRoot, transactionRoot)
  ) {
    artifactFailure("invalid-plan", "$.stageRoot");
  }
  if (
    plan.artifacts.some(
      (transition) => transition.path === plan.commitMarker.path,
    )
  ) {
    artifactFailure("invalid-plan", plan.commitMarker.path);
  }

  const transitions = [...plan.artifacts, plan.commitMarker];
  const liveIdentities = new Map<string, string>();
  const stagedIdentities = new Map<string, string>();
  const allIdentities = new Map<string, string>([
    [portableIdentity(transactionRoot), transactionRoot],
    [portableIdentity(stageRoot), stageRoot],
  ]);
  for (const [index, transition] of transitions.entries()) {
    const subject =
      index === plan.artifacts.length
        ? "$.commitMarker"
        : `$.artifacts[${index}]`;
    validateTransition(transition, subject, stageRoot);
    if (
      isWithin(transactionRoot, transition.path) ||
      isWithin(transition.path, transactionRoot) ||
      isWithin(stageRoot, transition.path) ||
      isWithin(transition.path, stageRoot)
    ) {
      artifactFailure("control-path-collision", transition.path);
    }
    const liveIdentity = portableIdentity(transition.path);
    const previousLive = liveIdentities.get(liveIdentity);
    if (previousLive !== undefined) {
      artifactFailure(
        "portable-path-collision",
        transition.path,
      );
    }
    liveIdentities.set(liveIdentity, transition.path);
    const priorIdentity = allIdentities.get(liveIdentity);
    if (priorIdentity !== undefined) {
      artifactFailure(
        "portable-path-collision",
        transition.path,
      );
    }
    allIdentities.set(liveIdentity, transition.path);
    if (transition.stagedPath !== null) {
      const stagedIdentity = portableIdentity(transition.stagedPath);
      const previousStaged = stagedIdentities.get(stagedIdentity);
      if (previousStaged !== undefined) {
        artifactFailure(
          "portable-path-collision",
          transition.stagedPath,
        );
      }
      stagedIdentities.set(stagedIdentity, transition.stagedPath);
      const priorStagedIdentity = allIdentities.get(stagedIdentity);
      if (priorStagedIdentity !== undefined) {
        artifactFailure(
          "portable-path-collision",
          transition.stagedPath,
        );
      }
      allIdentities.set(stagedIdentity, transition.stagedPath);
    }
  }

  const artifactPaths = plan.artifacts.map((transition) => transition.path);
  const sortedPaths = [...artifactPaths].sort();
  if (artifactPaths.some((entry, index) => entry !== sortedPaths[index])) {
    artifactFailure("invalid-plan", "$.artifacts");
  }
  if (artifactPaths.includes(plan.commitMarker.path)) {
    artifactFailure("invalid-plan", plan.commitMarker.path);
  }
  if (sameState(plan.commitMarker.prior, plan.commitMarker.next)) {
    artifactFailure("invalid-plan", plan.commitMarker.path);
  }
  return plan;
}
