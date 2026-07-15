import type {Feature} from "genes-dts2hx-esm-fixture/feature";

export declare const version: "esm-fixture-1";

export declare class Formatter {
  constructor(prefix: string);
  readonly prefix: string;
  format(value: string): string;
  feature(name: string): Feature;
}

export {createFeature} from "genes-dts2hx-esm-fixture/feature";
export type {Feature} from "genes-dts2hx-esm-fixture/feature";
