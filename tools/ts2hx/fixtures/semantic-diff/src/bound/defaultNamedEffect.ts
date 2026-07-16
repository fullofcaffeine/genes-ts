import { events } from "./state.js";

const initialized = events.push("default-named");

/** Default half of a combined default/named request. */
export default initialized;

/** Named half of a combined default/named request. */
export const namedValue = initialized + 10;
