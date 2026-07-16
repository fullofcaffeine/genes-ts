import {FinallyCompletion as ClassicCompletion} from "./out/classic/genes/js/FinallyCompletion.js";
import {FinallyCompletion as TypeScriptCompletion} from "./out/ts/src-gen/genes/js/FinallyCompletion.js";

type ReturnCarrier = Readonly<{
  kind: "return";
  value: number;
}>;

const protectedResult = (): ReturnCarrier => ({kind: "return", value: 7});
const normalFinalizer = (): null => null;

const classicResult: ReturnCarrier | null = ClassicCompletion.run(
  protectedResult,
  normalFinalizer
);
const typescriptResult: ReturnCarrier | null = TypeScriptCompletion.run(
  protectedResult,
  normalFinalizer
);

void classicResult;
void typescriptResult;
export {};
