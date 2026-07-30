import { Selected } from "./out/ts/src-gen/module_functions/Selected.js";
import {
  publicByFieldName,
  publicIdentity,
  exposedOnly
} from "./out/ts/src-gen/index.js";

const generic = Selected.selected({ label: "consumer", detail: 42 }, "!", "x");
const publicGeneric = publicIdentity({ label: "consumer", detail: 42 });
const publicDetail: number = publicGeneric.detail;
const publicByName: number = publicByFieldName(1);
const exposedOnlyResult: number = exposedOnly(1);
const recursive: number = Selected.recursive(2);
const renamed: number = Selected.renamedSelected(2);
const loaded: Promise<number> = Selected.load(1);

void [
  generic,
  publicDetail,
  publicByName,
  exposedOnlyResult,
  recursive,
  renamed,
  loaded
];
