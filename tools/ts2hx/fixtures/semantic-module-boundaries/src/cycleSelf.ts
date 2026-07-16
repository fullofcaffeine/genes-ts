import { selfValue as prior } from "./cycleSelf.js";

/** A self-request is an SCC even though the graph contains only one module. */
export const selfValue: number = prior + 1;
