import { value as aliasedValue } from "./mutableTarget.js";

/** An alias does not turn a mutable ESM binding into an immutable snapshot. */
export const observed = aliasedValue;
