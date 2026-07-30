package module_functions;

/**
 * Generic enum used to prove that literal `null` does not narrow a direct
 * module function's TypeScript payload inference.
 */
enum NullInference<T> {
  Missing(value: T);
}
