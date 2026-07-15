import { events } from "./state.js";

// Deliberately occupies the stable base marker name to prove suffix allocation.
const __ts2hx_init_380351706d = "user-owned";

/** The retained initializer is the first binding-free module effect. */
export const initialized = events.push("first");
