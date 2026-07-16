import { b } from "./cycleBoundB.js";

/** One half of a bound ESM cycle whose TDZ behavior is not yet promoted. */
export const a: number = b + 1;
