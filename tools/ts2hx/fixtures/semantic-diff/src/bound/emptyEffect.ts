import { events } from "./state.js";

/** Effect reached through an explicit empty import declaration. */
export const initialized = events.push("empty");
