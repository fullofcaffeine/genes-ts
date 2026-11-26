import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";

import {
  DEVELOPMENT_SESSION_EVENT_PROTOCOL,
  DEVELOPMENT_SESSION_EVENT_VERSION,
  type AcceptedGeneration,
  type DevelopmentEvent,
  type DevelopmentSession,
  type DevelopmentSnapshot,
  type GenesDevelopmentOptions,
  type JsonValue,
  type ObservedExtraInput,
} from "./session/index.js";

type Family =
  | "startup"
  | "admission"
  | "scheduling"
  | "compiler"
  | "publication"
  | "shutdown";
type StateKind =
  | "opening"
  | "building"
  | "blocked"
  | "ready"
  | "degraded"
  | "closing"
  | "closed";
type EventKind =
  | "state"
  | "inputs-changed"
  | "build-started"
  | "candidate-generated"
  | "candidate-superseded"
  | "generation-accepted"
  | "failed"
  | "compiler-lifecycle"
  | "output-check"
  | "preview-generated"
  | "preview-refused"
  | "preview-confirmed"
  | "preview-corrected"
  | "closed";

interface EventRun {
  readonly kind: EventKind;
  readonly count: number;
}

interface Expected {
  readonly finalState: StateKind;
  readonly revisionsObserved: number;
  readonly acceptedGenerations: number;
  readonly acceptedRevision: number | null;
  readonly retainedGeneration: number | null;
  readonly firstAccepted: "resolved" | "pending" | "rejected";
  readonly publicationAttempts: number;
  readonly publicWrites: number;
  readonly readBarrier:
    | "not-exercised"
    | "publication-waited-for-reader";
  readonly eventRuns: readonly EventRun[];
  readonly stateKinds: readonly StateKind[];
  readonly eventChecks: readonly DevelopmentEvent<JsonValue>[];
  readonly snapshot: DevelopmentSnapshot<JsonValue>;
}

interface Vector {
  readonly id: string;
  readonly family: Family;
  readonly covers: readonly string[];
  readonly description: string;
  readonly extraInputs?: readonly ObservedExtraInput[];
  readonly script: readonly string[];
  readonly expected: Expected;
}

interface Corpus {
  readonly protocol: "genes.tooling.development-session-vectors";
  readonly version: 1;
  readonly vectors: readonly Vector[];
}

interface ProtocolSchema {
  readonly $schema: string;
  readonly $id: string;
  readonly $ref: string;
  readonly title: string;
  readonly $defs: Readonly<Record<string, JsonValue>>;
}

interface VectorSchema {
  readonly $schema: string;
  readonly $id: string;
  readonly title: string;
  readonly type: "object";
  readonly additionalProperties: false;
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, JsonValue>>;
  readonly $defs: Readonly<Record<string, JsonValue>>;
}

function assertPortableDelta(
  vectorId: string,
  accepted: AcceptedGeneration,
): void {
  const allPaths = [
    ...accepted.files.created,
    ...accepted.files.updated,
    ...accepted.files.deleted,
  ];
  assert.equal(
    new Set(allPaths).size,
    allPaths.length,
    `${vectorId}: accepted file-delta lists must be disjoint`,
  );
  for (const [kind, paths] of Object.entries(accepted.files)) {
    assert.deepEqual(
      paths,
      [...paths].sort((left, right) =>
        Buffer.from(left).compare(Buffer.from(right)),
      ),
      `${vectorId}: ${kind} paths must use deterministic UTF-8 order`,
    );
  }
}

const protocolSchema = JSON.parse(
  readFileSync(
    new URL(
      "../development-session/v1/protocol.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as ProtocolSchema;
assert.deepEqual(Object.keys(protocolSchema).sort(), [
  "$defs",
  "$id",
  "$ref",
  "$schema",
  "title",
]);
assert.equal(
  protocolSchema.$id,
  "https://genes-ts.dev/schemas/development-session-event-v1.json",
);
assert.equal(protocolSchema.$ref, "#/$defs/developmentEvent");
for (const definition of [
  "acceptedGeneration",
  "compilerLifecycle",
  "developmentEvent",
  "developmentSnapshot",
  "eventBody",
  "failure",
  "fileDelta",
  "inputPath",
  "publishedPath",
  "state",
]) {
  assert.equal(
    definition in protocolSchema.$defs,
    true,
    `event schema is missing $defs.${definition}`,
  );
}
const publishedPath = protocolSchema.$defs.publishedPath as {
  readonly pattern: string;
};
const inputPath = protocolSchema.$defs.inputPath as {
  readonly pattern: string;
};
const publishedPathPattern = new RegExp(publishedPath.pattern, "u");
const inputPathPattern = new RegExp(inputPath.pattern, "u");
for (const accepted of ["src-gen/index.ts", "generated/éxample.tsx"]) {
  assert.match(accepted, publishedPathPattern);
  assert.match(accepted, inputPathPattern);
}
assert.doesNotMatch(
  "@external/1/library/src/Value.hx",
  publishedPathPattern,
);
assert.match("@external/1/library/src/Value.hx", inputPathPattern);
for (const malformedExternalInput of [
  "@external",
  "@external/not-a-number",
  "@external/01/library/src/Value.hx",
]) {
  assert.doesNotMatch(malformedExternalInput, inputPathPattern);
}
for (const rejected of [
  "",
  "/absolute.ts",
  ".",
  "./relative.ts",
  "../outside.ts",
  "nested/../outside.ts",
  "windows\\path.ts",
  "nul\0path.ts",
]) {
  assert.doesNotMatch(rejected, publishedPathPattern);
  assert.doesNotMatch(rejected, inputPathPattern);
}

const vectorSchema = JSON.parse(
  readFileSync(
    new URL(
      "../development-session/v1/vectors.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as VectorSchema;
assert.deepEqual(Object.keys(vectorSchema).sort(), [
  "$defs",
  "$id",
  "$schema",
  "additionalProperties",
  "properties",
  "required",
  "title",
  "type",
]);
assert.equal(
  vectorSchema.$id,
  "https://genes-ts.dev/schemas/development-session-vectors-v1.json",
);
assert.deepEqual(vectorSchema.required, ["protocol", "version", "vectors"]);
for (const definition of [
  "eventKind",
  "eventRun",
  "expected",
  "extraInput",
  "scriptStep",
  "vector",
]) {
  assert.equal(
    definition in vectorSchema.$defs,
    true,
    `vector schema is missing $defs.${definition}`,
  );
}

const corpus = JSON.parse(
  readFileSync(
    new URL("../development-session/v1/vectors.json", import.meta.url),
    "utf8",
  ),
) as Corpus;

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(protocolSchema);
const validateCorpus = ajv.compile(vectorSchema);
assert.equal(
  validateCorpus(corpus),
  true,
  `development-session vectors must satisfy both released schemas:\n${ajv.errorsText(
    validateCorpus.errors,
    { separator: "\n" },
  )}`,
);
// The output-check event (genes-f8vc.9.23) is emitted only with
// `generationReuse`; its released shape is checked here.
const validateProtocolEvent = ajv.getSchema(protocolSchema.$id);
assert.notEqual(validateProtocolEvent, undefined);
for (const [outputCheck, valid] of [
  [{ check: "cold-build", revision: 3, generation: 3, result: "differs", paths: ["src-gen/index.ts"] }, true],
  [{ check: "replay-audit", revision: 2, result: "differs", modules: ["inc.Stale"] }, true],
  [{ check: "replay-audit", revision: 2, result: "differs", modules: ["inc.Stale"], code: "AUDIT_REPEATED" }, true],
  [{ check: "cold-build", revision: 4, generation: 4, result: "cancelled", paths: [] }, true],
  [{ check: "cold-build", revision: 5, generation: 5, result: "differs", paths: [], code: "COLD_BUILD_FAILED", message: "Main.hx:1: Type not found" }, true],
  [{ check: "cold-build", revision: 5, generation: 5, result: "failed", paths: [], code: "PREPARED_FILES_CHANGED" }, true],
  [{ check: "cold-build", revision: 5, generation: 5, result: "unknown", paths: [] }, false],
  [{ check: "cold-build", revision: 5, generation: 0, result: "equal", paths: [] }, false],
  [{ check: "cold-build", revision: 5, generation: 5, result: "differs", paths: ["/private/candidate/index.ts"] }, false],
  [{ check: "replay-audit", revision: 2, result: "differs", modules: [] }, false],
  [{ check: "replay-audit", revision: 2, result: "differs", modules: ["inc.Stale"], extra: 1 }, false],
  [{ check: "replay-audit", revision: 2, result: "differs", paths: ["inc.Stale"] }, false],
] as const) {
  assert.equal(
    validateProtocolEvent!({
      protocol: DEVELOPMENT_SESSION_EVENT_PROTOCOL,
      version: DEVELOPMENT_SESSION_EVENT_VERSION,
      sequence: 1,
      at: 1,
      event: { kind: "output-check", outputCheck },
    }),
    valid,
    `output-check ${JSON.stringify(outputCheck)} must be ${valid ? "valid" : "rejected"}`,
  );
}
// Parity stage 0 (genes-19wt): the `started` endpoint is either a loopback
// address or the fixed stdio endpoint, never a mix; `transport-failed`
// reports why the stdio pipe broke.
for (const [event, valid] of [
  [{ kind: "started", endpoint: { host: "127.0.0.1", port: 6000, argument: "127.0.0.1:6000" } }, true],
  [{ kind: "started", endpoint: { transport: "stdio", argument: "stdio" } }, true],
  [{ kind: "started", endpoint: { transport: "stdio", argument: "stdio", port: 6000 } }, false],
  [{ kind: "started", endpoint: { host: "127.0.0.1", port: 6000, argument: "stdio", transport: "stdio" } }, false],
  [{ kind: "started", endpoint: { transport: "stdio", argument: "127.0.0.1:6000" } }, false],
  [{ kind: "started", endpoint: { transport: "tcp", argument: "stdio" } }, false],
  [{ kind: "transport-failed", reason: "bytes arrived outside a frame while no request waited", firstBytes: "noise\n" }, true],
  [{ kind: "transport-failed", reason: "the server closed its standard error", firstBytes: "" }, true],
  [{ kind: "transport-failed", reason: "", firstBytes: "" }, false],
  [{ kind: "transport-failed", reason: "x" }, false],
] as const) {
  assert.equal(
    validateProtocolEvent!({
      protocol: DEVELOPMENT_SESSION_EVENT_PROTOCOL,
      version: DEVELOPMENT_SESSION_EVENT_VERSION,
      sequence: 1,
      at: 1,
      event: { kind: "compiler-lifecycle", event },
    }),
    valid,
    `compiler-lifecycle ${JSON.stringify(event)} must be ${valid ? "valid" : "rejected"}`,
  );
}
// Module previews (genes-f8vc.14.3) are emitted only with `modulePreview`;
// their released shapes are checked here.
const sha = "a".repeat(64);
for (const [event, valid] of [
  [{ kind: "preview-generated", revision: 2, module: "ui.Button", files: [{ path: "src-gen/ui/Button.ts", sha256: sha, sizeBytes: 3 }] }, true],
  [{ kind: "preview-generated", revision: 2, module: "ui.Button", files: [] }, false],
  [{ kind: "preview-generated", revision: 2, module: "ui.Button", files: [{ path: "/private/candidate/ui/Button.ts", sha256: sha, sizeBytes: 3 }] }, false],
  [{ kind: "preview-generated", revision: 2, module: "ui/Button", files: [{ path: "src-gen/ui/Button.ts", sha256: sha, sizeBytes: 3 }] }, false],
  [{ kind: "preview-refused", revision: 2, module: null, source: "session", code: "several-modules" }, true],
  [{ kind: "preview-refused", revision: 2, module: "ui.Button", source: "genes", code: "public-shape-changed" }, true],
  [{ kind: "preview-refused", revision: 2, module: "ui.Button", source: "host", code: "several-modules" }, false],
  [{ kind: "preview-refused", revision: 2, module: "ui.Button", source: "genes", code: "Public shape" }, false],
  [{ kind: "preview-confirmed", revision: 2, module: "ui.Button", generation: 2, paths: ["src-gen/ui/Button.ts"] }, true],
  [{ kind: "preview-confirmed", revision: 2, module: "ui.Button", generation: 2, paths: [] }, false],
  [{ kind: "preview-corrected", revision: 2, module: "ui.Button", generation: 2, paths: ["src-gen/ui/Button.ts"], cause: "differs" }, true],
  [{ kind: "preview-corrected", revision: 2, module: "ui.Button", generation: 3, paths: ["src-gen/ui/Button.ts"], cause: "newer-revision" }, true],
  [{ kind: "preview-corrected", revision: 2, module: "ui.Button", generation: 2, paths: ["src-gen/ui/Button.ts"] }, false],
  [{ kind: "preview-corrected", revision: 2, module: "ui.Button", generation: 2, paths: ["src-gen/ui/Button.ts"], cause: "stale" }, false],
] as const) {
  assert.equal(
    validateProtocolEvent!({
      protocol: DEVELOPMENT_SESSION_EVENT_PROTOCOL,
      version: DEVELOPMENT_SESSION_EVENT_VERSION,
      sequence: 1,
      at: 1,
      event,
    }),
    valid,
    `${event.kind} ${JSON.stringify(event)} must be ${valid ? "valid" : "rejected"}`,
  );
}
const invalidSequenceCorpus = structuredClone(corpus) as unknown as {
  vectors: Array<{
    expected: { eventChecks: Array<{ sequence: number }> };
  }>;
};
invalidSequenceCorpus.vectors[0].expected.eventChecks[0].sequence = 0;
assert.equal(
  validateCorpus(invalidSequenceCorpus),
  false,
  "the released validator must reject an invalid protocol event",
);
const externalPublishedPathCorpus = structuredClone(corpus) as unknown as {
  vectors: Array<{
    expected: {
      snapshot: {
        accepted: { files: { created: string[] } } | null;
      };
    };
  }>;
};
externalPublishedPathCorpus.vectors[0].expected.snapshot.accepted!.files.created = [
  "@external/1/library/src/Value.hx",
];
assert.equal(
  validateCorpus(externalPublishedPathCorpus),
  false,
  "published file lists must reject private external-input paths",
);
const malformedExternalInputCorpus = structuredClone(corpus) as unknown as {
  vectors: Array<{
    expected: {
      eventChecks: Array<{
        event: { kind: string; paths?: string[] };
      }>;
    };
  }>;
};
const externalInputEvent = malformedExternalInputCorpus.vectors
  .flatMap((vector) => vector.expected.eventChecks)
  .find((event) => event.event.kind === "inputs-changed");
assert.notEqual(externalInputEvent, undefined);
externalInputEvent!.event.paths = ["@external/not-a-number/Main.hx"];
assert.equal(
  validateCorpus(malformedExternalInputCorpus),
  false,
  "input-change events must reject malformed private external-input paths",
);
const privatePathCorpus = structuredClone(corpus) as unknown as {
  vectors: Array<{
    expected: { snapshot: Record<string, unknown> };
  }>;
};
privatePathCorpus.vectors[0].expected.snapshot.candidatePath =
  "/tmp/private-candidate";
assert.equal(
  validateCorpus(privatePathCorpus),
  false,
  "session snapshots must reject unplanned private candidate fields",
);

assert.deepEqual(
  Object.keys(corpus).sort(),
  ["protocol", "vectors", "version"],
);
assert.equal(corpus.protocol, "genes.tooling.development-session-vectors");
assert.equal(corpus.version, 1);
assert.equal(Array.isArray(corpus.vectors), true);

const families = new Set<Family>([
  "startup",
  "admission",
  "scheduling",
  "compiler",
  "publication",
  "shutdown",
]);
const states = new Set<StateKind>([
  "opening",
  "building",
  "blocked",
  "ready",
  "degraded",
  "closing",
  "closed",
]);
const events = new Set<EventKind>([
  "state",
  "inputs-changed",
  "build-started",
  "candidate-generated",
  "candidate-superseded",
  "generation-accepted",
  "failed",
  "compiler-lifecycle",
  "output-check",
  "preview-generated",
  "preview-refused",
  "preview-confirmed",
  "preview-corrected",
  "closed",
]);
const scriptSteps = new Set([
  "start",
  "recovery-none",
  "recovery-committed",
  "existing-generation-imported",
  "existing-generation-replaced",
  "existing-generation-retried",
  "watch-registered",
  "input-change",
  "input-burst-20",
  "input-change-equal-content",
  "build-started",
  "compile-connected",
  "compile-connected-private-hxml",
  "compile-direct",
  "compile-failed",
  "compile-connected-replay-audit-differs",
  "compile-module-preview",
  "compile-module-preview-differs",
  "private-hxml-removed-before-validation",
  "inventory-failed-fatal",
  "candidate-generated",
  "output-check-replay-audit",
  "preview-generated",
  "preview-refused-previews-stopped",
  "preview-confirmed",
  "preview-corrected-differs",
  "validate-accepted",
  "validate-rejected",
  "reconcile-current",
  "reconcile-superseded",
  "publish-succeeded",
  "publish-unchanged",
  "publish-failed",
  "compiler-fallback-unresponsive",
  "client-subscribed-buffering",
  "client-inspected",
  "read-acquired",
  "read-released",
  "close",
  "close-again",
]);

for (const vector of corpus.vectors) {
  const keys = ["covers", "description", "expected", "family", "id", "script"];
  if (vector.extraInputs !== undefined) keys.push("extraInputs");
  assert.deepEqual(
    Object.keys(vector).sort(),
    keys.sort(),
  );
  assert.match(vector.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  assert.equal(families.has(vector.family), true);
  assert.equal(vector.covers.length > 0, true);
  assert.equal(new Set(vector.covers).size, vector.covers.length);
  for (const coverage of vector.covers) {
    assert.match(coverage, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  }
  assert.equal(vector.description.length > 0, true);
  assert.equal(vector.script.length > 0, true);
  for (const step of vector.script) {
    assert.equal(scriptSteps.has(step), true, `${vector.id}: unknown ${step}`);
  }

  const expected = vector.expected;
  assert.deepEqual(Object.keys(expected).sort(), [
    "acceptedGenerations",
    "acceptedRevision",
    "eventChecks",
    "eventRuns",
    "finalState",
    "firstAccepted",
    "publicWrites",
    "publicationAttempts",
    "readBarrier",
    "retainedGeneration",
    "revisionsObserved",
    "snapshot",
    "stateKinds",
  ]);
  assert.equal(states.has(expected.finalState), true);
  assert.equal(Number.isInteger(expected.revisionsObserved), true);
  assert.equal(expected.revisionsObserved >= 0, true);
  assert.equal(Number.isInteger(expected.acceptedGenerations), true);
  assert.equal(expected.acceptedGenerations >= 0, true);
  assert.equal(expected.publicWrites <= expected.publicationAttempts, true);
  assert.equal(
    expected.stateKinds.at(-1),
    expected.finalState,
    `${vector.id}: final state trace differs from finalState`,
  );
  for (const state of expected.stateKinds) assert.equal(states.has(state), true);
  for (const run of expected.eventRuns) {
    assert.deepEqual(Object.keys(run).sort(), ["count", "kind"]);
    assert.equal(events.has(run.kind), true);
    assert.equal(Number.isInteger(run.count) && run.count > 0, true);
  }

  const expandedKinds = expected.eventRuns.flatMap((run) =>
    Array.from({ length: run.count }, () => run.kind),
  );
  assert.equal(
    expected.snapshot.lastSequence,
    expandedKinds.length,
    `${vector.id}: snapshot must cover every emitted event`,
  );
  assert.equal(
    expected.snapshot.newestRevision,
    expected.revisionsObserved,
    `${vector.id}: snapshot revision differs from vector outcome`,
  );
  assert.equal(expected.snapshot.state.kind, expected.finalState);
  assert.equal(
    expected.snapshot.accepted?.generation ?? null,
    expected.retainedGeneration,
  );
  assert.equal(
    expected.snapshot.accepted?.revision ?? null,
    expected.acceptedRevision,
  );

  let priorCheckedSequence = 0;
  for (const checked of expected.eventChecks) {
    assert.equal(checked.protocol, DEVELOPMENT_SESSION_EVENT_PROTOCOL);
    assert.equal(checked.version, DEVELOPMENT_SESSION_EVENT_VERSION);
    assert.equal(
      checked.sequence > priorCheckedSequence,
      true,
      `${vector.id}: event checks must be ordered and unique`,
    );
    assert.equal(
      expandedKinds[checked.sequence - 1],
      checked.event.kind,
      `${vector.id}: checked payload does not match the declared event run`,
    );
    priorCheckedSequence = checked.sequence;
  }


  const checkedAccepted = expected.eventChecks.filter(
    (event) => event.event.kind === "generation-accepted",
  );
  const checkedFailures = expected.eventChecks.filter(
    (event) => event.event.kind === "failed",
  );
  const checkedCompilerEvents = expected.eventChecks.filter(
    (event) => event.event.kind === "compiler-lifecycle",
  );
  assert.equal(
    checkedAccepted.length,
    expected.acceptedGenerations,
    `${vector.id}: every admitted generation needs an exact payload check`,
  );
  assert.equal(
    checkedFailures.length,
    expandedKinds.filter((kind) => kind === "failed").length,
    `${vector.id}: every failure needs an exact phase and recoverability check`,
  );
  assert.equal(
    checkedCompilerEvents.length,
    expandedKinds.filter((kind) => kind === "compiler-lifecycle").length,
    `${vector.id}: every compiler lifecycle fact needs an exact payload check`,
  );

  if (expected.snapshot.accepted != null)
    assertPortableDelta(vector.id, expected.snapshot.accepted);
  for (const event of checkedAccepted) {
    if (event.event.kind === "generation-accepted")
      assertPortableDelta(vector.id, event.event.accepted);
  }
}

const ids = corpus.vectors.map((vector) => vector.id);
assert.equal(new Set(ids).size, ids.length, "vector IDs must be unique");
assert.deepEqual(
  [...ids].sort((left, right) => Buffer.from(left).compare(Buffer.from(right))),
  [
    "burst-supersedes-active-candidate",
    "close-before-first-accepted-is-idempotent",
    "compile-failure-retains-last-good",
    "equal-content-starts-no-build",
    "existing-generation-replacement-retry-retains-acceptance",
    "existing-generation-replacement-survives-first-build-failure",
    "existing-generation-survives-first-build-failure",
    "fatal-inventory-failure-rejects-first-accepted",
    "initial-compile-failure-repairs",
    "initial-validation-failure-repairs",
    "inline-hxml-option-stays-private",
    "late-attach-observes-compiler-fallback",
    "module-preview-confirmed-at-acceptance",
    "module-preview-difference-stops-previews",
    "publication-waits-for-reader",
    "publish-failure-rolls-back",
    "recovery-before-initial-build",
    "replay-audit-difference-is-never-published",
    "supplemental-files-publish-and-delete",
    "unchanged-candidate-advances-generation",
    "validation-failure-retains-last-good",
  ],
  "every released session vector needs a focused runtime owner in G2",
);

const covers = new Set(corpus.vectors.flatMap((vector) => vector.covers));
for (const required of [
  "accepted-before-notify",
  "bounded-close",
  "commit-before-notify",
  "current-session-admission",
  "direct-fallback",
  "equal-content-no-build",
  "existing-generation-import",
  "existing-generation-replacement",
  "exact-replacement-retry",
  "no-repeat-publication",
  "exact-prior-marker",
  "external-generation",
  "external-input-logical-path",
  "first-accepted-rejection",
  "idempotent-close",
  "inline-hxml-option",
  "last-good",
  "module-preview",
  "newest-state-follow-up",
  "private-candidate",
  "preview-correction",
  "private-compiler-input",
  "public-output-clean",
  "read-lease",
  "recovery-before-watch",
  "repair-without-restart",
  "rollback",
  "single-active-build",
  "snapshot-current-facts",
  "stale-candidate-not-published",
  "supplemental-publication",
  "supplemental-rollback",
  "supplemental-stale-deletion",
  "structured-event",
  "subscribe-inspect-gap",
  "supersession",
  "writer-priority",
]) {
  assert.equal(covers.has(required), true, `missing coverage: ${required}`);
}

const attachVector = corpus.vectors.find(
  (vector) => vector.id === "late-attach-observes-compiler-fallback",
);
assert.ok(attachVector);
assert.deepEqual(attachVector.expected.snapshot.lastCompilerEvent, {
  kind: "fallback",
  reason: "server-unresponsive",
});
assert.equal(attachVector.expected.snapshot.accepted?.compilerMode, "direct");
assert.equal(
  attachVector.expected.eventChecks.some(
    (event) =>
      event.event.kind === "compiler-lifecycle" &&
      event.event.event.kind === "fallback" &&
      event.event.event.reason === "server-unresponsive",
  ),
  true,
  "the subscribe/inspect race must preserve the exact compiler fallback fact",
);

const unchangedVector = corpus.vectors.find(
  (vector) => vector.id === "unchanged-candidate-advances-generation",
);
assert.ok(unchangedVector);
const unchangedAccepted = unchangedVector.expected.eventChecks
  .filter((event) => event.event.kind === "generation-accepted")
  .map((event) =>
    event.event.kind === "generation-accepted" ? event.event.accepted : null,
  );
assert.equal(unchangedAccepted.length, 2);
assert.equal(
  unchangedAccepted[0]?.manifestDigest,
  unchangedAccepted[1]?.manifestDigest,
  "an unchanged candidate advances generation without inventing new bytes",
);
assert.deepEqual(unchangedAccepted[1]?.files, {
  created: [],
  updated: [],
  deleted: [],
});

const encoded = JSON.stringify(corpus).toLowerCase();
for (const forbidden of [
  "vite",
  "nextjs",
  "next.js",
  "react",
  "wordpress",
  "gutenberg",
  "electron",
]) {
  assert.equal(
    encoded.includes(forbidden),
    false,
    `framework vocabulary leaked into shared vectors: ${forbidden}`,
  );
}

type Diagnostic = {
  readonly code: string;
  readonly details: readonly JsonValue[];
};
const acceptedEvent: DevelopmentEvent<Diagnostic> = {
  protocol: DEVELOPMENT_SESSION_EVENT_PROTOCOL,
  version: DEVELOPMENT_SESSION_EVENT_VERSION,
  sequence: 8,
  at: 1_785_520_800_000,
  event: {
    kind: "generation-accepted",
    accepted: {
      generation: 2,
      revision: 3,
      acceptedAt: 1_785_520_800_000,
      manifestDigest: "a".repeat(64),
      compilerMode: "connected",
      files: {
        created: [],
        updated: ["src-gen/index.tsx"],
        deleted: [],
      },
      entryChanged: true,
    },
  },
};
assert.deepEqual(JSON.parse(JSON.stringify(acceptedEvent)), acceptedEvent);

const typeWitness:
  | DevelopmentSession<Diagnostic>
  | DevelopmentSnapshot<Diagnostic>
  | GenesDevelopmentOptions<Diagnostic>
  | undefined = undefined;
void typeWitness;

console.log(
  `genes tooling development-session vectors: ${corpus.vectors.length} covered`,
);
