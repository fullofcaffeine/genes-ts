import { transitiveEvents } from "./transitiveBoundState.js";

/** Records the first request in the transitive target's source order. */
export const first = transitiveEvents.push("bound-first");
