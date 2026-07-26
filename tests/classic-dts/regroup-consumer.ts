import type {
  RegroupResult,
  RegroupStatus
} from "../../bin/tink/streams/Stream.js";
import { RegroupIdentityApi } from "../../bin/tests/regroupidentity/RegroupIdentityApi.js";

// Tink's own declarations and every reference to them must remain legal and
// generic. They are ordinary Haxe enum types, not weak compiler boundaries.
declare const flowing: RegroupStatus.Flowing<string>;
declare const result: RegroupResult<number, string, boolean>;

const status: RegroupStatus<string> = flowing;
const statusIndex: number = status._hx_index;
const resultIndex: number = result._hx_index;

void statusIndex;
void resultIndex;

const ordinaryStatus = RegroupIdentityApi.status("flowing");
const ordinaryResult = RegroupIdentityApi.result(7, "converted", true);

const statusValue: string = ordinaryStatus.value;
const resultInput: number = ordinaryResult.input;
const resultOutput: string = ordinaryResult.output;
const resultQuality: boolean = ordinaryResult.quality;

// These directives become errors when the compiler silently widens either
// unrelated same-named return type to `any`.
// @ts-expect-error RegroupStatus<String>.value is not a number.
const invalidStatusValue: number = ordinaryStatus.value;
// @ts-expect-error RegroupResult<Int, String, Bool>.output is not a number.
const invalidResultOutput: number = ordinaryResult.output;

void statusValue;
void resultInput;
void resultOutput;
void resultQuality;
void invalidStatusValue;
void invalidResultOutput;

export {};
