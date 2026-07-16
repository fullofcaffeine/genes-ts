import * as values from "./mutableTarget.js";

/** Static namespace reads still observe the target export's live binding. */
export const observed = values.value;
