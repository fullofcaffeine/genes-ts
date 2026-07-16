import {Main as ClassicMain} from "./out/classic/internaltypes/Main.js";
import type {PublicSibling as ClassicPublicSibling} from "./out/classic/internaltypes/Main.js";
import {Main as TypeScriptMain} from "./out/ts/src-gen/internaltypes/Main.js";
import type {PublicSibling as TypeScriptPublicSibling} from "./out/ts/src-gen/internaltypes/Main.js";

// @ts-expect-error compiler-internal types are absent from classic declarations
import type {InternalResult as ClassicInternalResult} from "./out/classic/internaltypes/Main.js";
// @ts-expect-error compiler-internal types remain local to genes-ts implementation
import type {InternalResult as TypeScriptInternalResult} from "./out/ts/src-gen/internaltypes/Main.js";

const classicValue: string = ClassicMain.evaluate("classic");
const classicState: ClassicPublicSibling = ClassicMain.publicState();
const typescriptValue: string = TypeScriptMain.evaluate("typescript");
const typescriptState: TypeScriptPublicSibling = TypeScriptMain.publicState();

void classicValue;
void classicState;
void typescriptValue;
void typescriptState;
export {};
