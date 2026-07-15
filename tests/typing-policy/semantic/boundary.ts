// These are intentional host-boundary shapes. Their manifest entries prove
// exceptions require exact ownership and provenance rather than a directory
// exclusion or a blanket allowance for `unknown`.
export type ForeignValue = unknown;
export interface ForeignRecord {
  readonly [key: string]: unknown;
}
