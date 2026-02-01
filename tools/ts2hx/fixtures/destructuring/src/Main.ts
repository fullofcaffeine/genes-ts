export type Nested = {
  c?: string;
};

export type Obj = {
  a?: number;
  b?: Nested;
  d?: number;
  e?: number;
};

export function main(): void {
  const obj: Obj = { a: 1, b: { c: "hi" }, d: 4, e: 5 };

  const { a, b: { c = "fallback" } = {}, ...rest } = obj;
  const { d: dd = 9 } = obj;

  let x: number = 0;
  ({ a: x } = obj);

  let y = "missing";
  ({ b: { c: y } = {} } = obj);

  const arr = [10, 20, 30, 40];
  const [first, , third = 33, ...tail] = arr;

  let second: number = 0;
  ([, second] = arr);

  const take = ({ a = 7, b: { c } = {} }: Obj = {}): string => {
    const suffix = c == null ? "none" : c;
    return `${a}:${suffix}`;
  };

  take(obj);
}
