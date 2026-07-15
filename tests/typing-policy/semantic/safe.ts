export interface ClosedShape {
  readonly name: string;
  readonly count: number | null;
}

export function collect(values: ReadonlyArray<ClosedShape>): Promise<ReadonlyArray<ClosedShape>> {
  return Promise.resolve(values);
}

// TS6's default library resolves the omitted iterator protocol slots to `any`.
// Those library-owned defaults are not emitted weak arguments.
export declare const strings: IterableIterator<string>;
