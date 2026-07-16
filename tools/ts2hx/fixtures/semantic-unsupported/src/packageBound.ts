import { parse } from "node:path";

/** Named object results remain outside the first strong package boundary. */
export function rootDirectory(): string {
  return parse("/").root;
}
