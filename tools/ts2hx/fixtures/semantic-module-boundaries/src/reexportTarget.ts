/** Runtime value requested by each rejected re-export spelling. */
export const value = 1;

/** Type-only re-exports remain outside the runtime request plan. */
export interface Marker {
  readonly kind: "marker";
}
