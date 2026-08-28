export const POSTCSS_MODULES_MAX_INPUTS = 256;
export const POSTCSS_MODULES_MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const POSTCSS_MODULES_MAX_IMPORT_DEPTH = 32;

// Depth zero is the entry. A chain at the maximum depth needs one final run
// after the last missing input is discovered.
export const POSTCSS_MODULES_MAX_DISCOVERY_RUNS =
  POSTCSS_MODULES_MAX_IMPORT_DEPTH + 1;
