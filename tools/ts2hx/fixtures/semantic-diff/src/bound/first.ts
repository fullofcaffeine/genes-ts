import { events } from "./state.js";

/** Records the first source-ordered bound module request. */
export const first = events.push("first");
