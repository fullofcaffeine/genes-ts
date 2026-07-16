/** Mutable target shared by aliased and namespace fail-closed requests. */
export let value = 1;

/** Makes the observable post-import mutation explicit. */
export function update(): void {
  value += 1;
}
