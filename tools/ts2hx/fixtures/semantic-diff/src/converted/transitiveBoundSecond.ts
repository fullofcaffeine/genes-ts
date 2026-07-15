import { transitiveEvents } from "./transitiveBoundState.js";

/** Records the second request in the transitive target's source order. */
export const second = transitiveEvents.push("bound-second");
