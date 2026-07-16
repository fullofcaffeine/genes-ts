import { events } from "./state.js";

const initialized = events.push("default-namespace");

/** Default half of a combined default/namespace request. */
export default initialized;

/** Statically read namespace half of the combined request. */
export const namespaceValue = initialized + 20;
