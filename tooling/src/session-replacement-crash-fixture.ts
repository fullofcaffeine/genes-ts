import { publishArtifacts } from "./artifacts/index.js";
import { readGenesOutput } from "./session/genes-output.js";
import { resolveSessionLayout } from "./session/layout.js";
import {
  prepareExistingGenerationImport,
  readPublishedMarker,
} from "./session/publication.js";
import { acquireSessionLock } from "./session/session-lock.js";

// Native observer: exit without finally/rollback at the real transaction
// boundary. The parent owns the synthetic tree and observes restart recovery.
const root = process.env.GENES_REPLACEMENT_ROOT;
const identity = process.env.GENES_REPLACEMENT_IDENTITY;
const checkpoint = process.env.GENES_REPLACEMENT_CHECKPOINT;
if (root === undefined || identity === undefined ||
    (checkpoint !== "after-journal-prepared" && checkpoint !== "after-publish:commit-marker")) {
  throw new Error("replacement crash fixture requires a root, identity and checkpoint");
}
const layout = resolveSessionLayout(root, identity, "src-gen/index.ts", ".genes/dev");
const lock = acquireSessionLock(layout);
try {
  const prior = readPublishedMarker(layout);
  if (prior.state.kind !== "file") throw new Error("fixture requires prior acceptance");
  const live = readGenesOutput(layout.publicOutputRoot, layout.outputIdentity, true)!;
  const prepared = prepareExistingGenerationImport(
    layout, `${layout.candidatesRelative}/replacement-crash`, live, [],
    123, {policy: "fixture"}, "replacement-crash", prior.state, prior.accepted,
  );
  await publishArtifacts({
    projectRoot: root,
    plan: prepared.plan,
    admitIntended: plan => plan.authorizationDigest === prepared.plan.authorizationDigest,
    faultInjector: current => { if (current === checkpoint) process.exit(73); },
  });
  throw new Error("fixture did not reach its crash checkpoint");
} finally {
  lock.release();
}
