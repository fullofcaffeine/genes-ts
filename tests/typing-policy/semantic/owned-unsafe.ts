import { weak } from "./weak.js";

// Deliberately inferred as `any`. The ownership-inventory test proves this
// module cannot evade the semantic audit merely because a caller forgot it.
export const ownedUnsafe = weak;
