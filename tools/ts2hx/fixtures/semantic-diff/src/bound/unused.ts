import { events } from "./state.js";

/** Records an import retained only by verbatim TypeScript module syntax. */
export const unused = events.push("unused");
