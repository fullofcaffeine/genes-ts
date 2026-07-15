import { first } from "./transitiveBoundFirst.js";
import { second } from "./transitiveBoundSecond.js";

/**
 * Keeps both bindings live while deliberately reading them in reverse order.
 * ESM must still initialize First before Second from declaration source order.
 */
export const consumed = `${second}:${first}`;
