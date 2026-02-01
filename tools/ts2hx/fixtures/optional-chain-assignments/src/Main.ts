export type Obj = {
  value?: number;
  nested?: {
    n?: number;
    fn?: (x: number) => number;
  };
};

export function main(): void {
  const obj: Obj | null = { value: 1, nested: { n: 2, fn: (x: number): number => x + 1 } };
  const nil: Obj | null = null;

  console.log(obj?.value);
  console.log(nil?.value);
  console.log(obj?.nested?.n);
  console.log(nil?.nested?.n);
  console.log(obj?.nested?.fn?.(1));
  console.log(obj.nested?.fn?.(2));

  const f: ((x: number) => number) | null = (x: number): number => x * 2;
  console.log(f?.(3));
  const g: ((x: number) => number) | null = null;
  console.log(g?.(3));

  let v: number | null = null;
  v ??= 10;
  console.log(v);
  v ??= 11;
  console.log(v);

  let b: boolean | null = null;
  b ??= true;
  console.log(b);
  b &&= false;
  console.log(b);
  b ||= true;
  console.log(b);
}

