import { readFileSync } from "node:fs";

import {
  publishArtifacts,
  type ArtifactCheckpoint,
  type PublicationPlan,
} from "./index.js";

const projectRoot = process.env.GENES_TOOLING_FIXTURE_ROOT;
const planPath = process.env.GENES_TOOLING_FIXTURE_PLAN;
const crashAt = process.env.GENES_TOOLING_FIXTURE_CRASH_AT as
  | ArtifactCheckpoint
  | undefined;
if (projectRoot === undefined || planPath === undefined || crashAt === undefined) {
  throw new Error("crash fixture requires root, plan, and checkpoint");
}

const plan = JSON.parse(readFileSync(planPath, "utf8")) as PublicationPlan;
await publishArtifacts({
  projectRoot,
  plan,
  faultInjector: (point) => {
    if (point === crashAt) {
      process.exit(73);
    }
  },
});
throw new Error(`checkpoint was not reached: ${crashAt}`);
