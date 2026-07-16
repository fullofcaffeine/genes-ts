import { call } from "./Types.js";
import * as Types from "./Types.js";

export function main(): void {
  const fn: Types.Fn = (a, b) => `${a}${b ?? ""}`;
  console.log(call(fn, 1, "x"));
}
