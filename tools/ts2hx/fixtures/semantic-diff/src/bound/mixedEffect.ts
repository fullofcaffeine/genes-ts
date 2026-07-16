import { events } from "./state.js";

/** Type half of a mixed type/value import clause. */
export interface MixedMarker {
  readonly kind: "mixed";
}

/** Immutable value half of a mixed type/value import clause. */
export const mixedValue = events.push("mixed");
