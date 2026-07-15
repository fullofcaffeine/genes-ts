import { weak } from "./weak.js";

// Every weak type below is deliberate test input. The fixture must compile so
// the policy test can prove that successful `tsc` is not a type-safety audit.
export type ExplicitAny = any;
export interface NestedAny {
  nested: { value: any };
}
export type ExplicitUnknown = unknown;
export interface OpenShape {
  [key: string]: string;
}
export interface GenericDefault<T = any> {
  value: T;
}
export type ConditionalLeak<T> = T extends string ? any : number;
export type MappedLeak<T> = { [K in keyof T]: any };
export const inferredFromImport = weak;
export { weak as reexportedWeak };
