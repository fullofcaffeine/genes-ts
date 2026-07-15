import "./first.js";
import "./second.js";
import { events } from "./state.js";
import "./first.js";

/** Prints the reduced source-order and once-only initialization proof. */
export function main(): void {
  console.log(`CONVERTED_TRACE:${events.join(",")}`);
}
