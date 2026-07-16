import { events } from "./state.js";

/** Declaration-wide type import target, which must never create a request. */
export interface DeclarationMarker {
  readonly kind: "declaration";
}

/** Would expose an accidental runtime request for `import type`. */
export const initialized = events.push("declaration-type");
