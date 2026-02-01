import { call } from "./Types";
import * as Types from "./Types";

export function main(): void {
  const fn: Types.Fn = (a, b) => `${a}${b ?? ""}`;
  console.log(call(fn, 1, "x"));
}

