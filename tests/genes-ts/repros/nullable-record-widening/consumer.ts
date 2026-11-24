import { NullableRecordProbe } from "./out/typescript/NullableRecordProbe.js";
import type { Review } from "./out/typescript/NullableRecordProbe.js";

const record: Review = { values: ["kept"] };
const nullable: Review | null = record;
NullableRecordProbe.accept(record);
NullableRecordProbe.accept(nullable);
NullableRecordProbe.accept();

function rejectMissing(value: Review | null): void {
  // @ts-expect-error A nullable value cannot satisfy a required record.
  NullableRecordProbe.identity(value);
}
// @ts-expect-error Optional means absent or String, not explicit undefined.
const wrongOptional: Review = { values: [], fingerprint: undefined };
// @ts-expect-error Widening does not change the element type.
NullableRecordProbe.accept({ values: [42] });
void rejectMissing;
void wrongOptional;
