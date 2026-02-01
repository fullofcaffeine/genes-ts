import * as NS from "./NS";

export type MaybeString = string | null | undefined;
export type MaybeNumOrStr = string | number | null;
export type Fn = (a: number, b?: string) => string;

export type Qualified = NS.Bar;

export function call(fn: Fn, a: number, b?: string): string {
  return fn(a, b);
}

