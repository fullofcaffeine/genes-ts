import type {
  RegroupResult,
  RegroupStatus
} from "../../bin/tink/streams/Stream.js";

// These tink helpers deliberately project to `any` when they occur inside
// legacy public signatures. Their own declarations must still retain legal,
// generic names so TypeScript can parse and consume the generated module.
declare const flowing: RegroupStatus.Flowing<string>;
declare const result: RegroupResult<number, string, boolean>;

const status: RegroupStatus<string> = flowing;
const statusIndex: number = status._hx_index;
const resultIndex: number = result._hx_index;

void statusIndex;
void resultIndex;

export {};
