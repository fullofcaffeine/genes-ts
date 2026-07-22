import { Selected } from "./out/ts/src-gen/module_functions/Selected.js";

const generic = Selected.selected({ label: "consumer", detail: 42 }, "!", "x");
const recursive: number = Selected.recursive(2);
const renamed: number = Selected.renamedSelected(2);
const loaded: Promise<number> = Selected.load(1);

void [generic, recursive, renamed, loaded];
