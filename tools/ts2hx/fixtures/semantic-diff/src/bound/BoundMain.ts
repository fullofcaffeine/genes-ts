import { unused as unusedValue } from "./unused.js";
import { first as firstValue } from "./first.js";
import { second as secondValue } from "./second.js";
import { events } from "./state.js";
import { first as firstAgain } from "./first.js";

/**
 * Prints the standalone bound-request proof.
 *
 * `unusedValue` deliberately has no value read, so TypeScript retains its
 * request only with verbatim module syntax. The used bindings are read in
 * reverse order to prove that expression traversal cannot replace declaration
 * order, while the repeated First request proves once-only module evaluation.
 */
export function main(): void {
  console.log(`BOUND_TRACE:${events.join(",")}|${secondValue}:${firstValue}:${firstAgain}`);
}
