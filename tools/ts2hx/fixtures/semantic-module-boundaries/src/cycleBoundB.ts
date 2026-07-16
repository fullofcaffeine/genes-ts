import { a } from "./cycleBoundA.js";

/** Other half of the bound ESM cycle. */
export const b: number = a + 1;
