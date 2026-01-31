import greet, { add } from "fakepkg";
import * as Pkg from "fakepkg";

export function main(): void {
  console.log(greet("world"));
  console.log(add(1, 2));
  console.log(Pkg.add(3, 4));
  console.log(Pkg.PI);
}

