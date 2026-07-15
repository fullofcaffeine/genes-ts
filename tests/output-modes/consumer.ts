import { DualApi, type DualReport } from "./out/classic/dual/DualApi.js";
import type { DualTypeOnly } from "./out/classic/dual/DualTypeOnly.js";
import type { StringMap } from "./out/classic/haxe/ds/StringMap.js";

const report = DualApi.summarize(["Ada"]);
const count: number = report.count;
const first: string | null = report.first;
const missing: string | undefined = report.missing;
const validWithoutLabel: DualReport = {
  count: 0,
  first: null,
  missing: undefined
};
const validWithLabel: DualReport = {
  ...validWithoutLabel,
  label: "reviewed"
};
declare const typeOnly: DualTypeOnly;
declare const compactMap: StringMap<number>;
const compactMapValue: number | null = compactMap.get("present");
const jsonValue = DualApi.jsonIdentity({ nested: ["value", 1, true, null] });

// @ts-expect-error nullable Haxe results must be narrowed by consumers.
const invalidFirst: string = report.first;
// @ts-expect-error Undefinable is not the same contract as explicit null.
const invalidMissing: null = report.missing;
// `@:ts.optional` deliberately permits an own undefined value at runtime.
const validUndefinedLabel: DualReport = {
  ...validWithoutLabel,
  label: undefined
};
// @ts-expect-error ordinary exact-optional fields reject explicit undefined.
const invalidOrdinaryOptional: DualReport = {
  ...validWithoutLabel,
  ordinaryOptional: undefined
};
// @ts-expect-error the declaration surface stays closed and typo-safe.
DualApi.nonexistent();
// @ts-expect-error functions are not native JSON values.
DualApi.jsonIdentity(() => "not-json");

void count;
void first;
void missing;
void validWithLabel;
void validUndefinedLabel;
void typeOnly;
void compactMapValue;
void jsonValue;
void invalidFirst;
void invalidMissing;
void invalidOrdinaryOptional;
