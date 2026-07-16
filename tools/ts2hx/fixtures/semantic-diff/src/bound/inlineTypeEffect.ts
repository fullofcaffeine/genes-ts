import { events } from "./state.js";

/** Type removed from the retained empty runtime request. */
export interface InlineMarker {
  readonly kind: "inline";
}

/** Effect reached when verbatim emit preserves the inline type-only clause. */
export const initialized = events.push("inline-type");
