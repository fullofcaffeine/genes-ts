export interface ClosedShape {
  readonly name: string;
  readonly count: number | null;
}

export function collect(values: ReadonlyArray<ClosedShape>): Promise<ReadonlyArray<ClosedShape>> {
  return Promise.resolve(values);
}
