import { events } from "./state.js";

/** The retained initializer must run after First and against the same State. */
export const initialized = events.push("second");
