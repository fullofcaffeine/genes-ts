/** Mutable exporter used to prove that imported live bindings fail closed. */
export let value = 1;

/** Makes the post-initialization mutation contract explicit. */
export function update(): void {
  value += 1;
}
