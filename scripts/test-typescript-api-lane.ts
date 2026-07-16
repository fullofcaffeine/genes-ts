import ts from "./typescript-api.js";
import { toolchains } from "./toolchains.js";

const bridge = toolchains.typescript.apiBridge;
const engine = bridge.programApiEngine;
if (!engine) {
  throw new Error("TypeScript API bridge has no declared Program API engine");
}
if (ts.version !== engine.version) {
  throw new Error(
    `TypeScript API engine mismatch: manifest=${engine.version}, runtime=${ts.version}`
  );
}

const source = ts.createSourceFile(
  "api-lane.ts",
  "export const answer: number = 42;",
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);
if (source.statements.length !== 1 || !ts.isVariableStatement(source.statements[0])) {
  throw new Error("TypeScript API bridge could not parse a typed module");
}

const host = ts.createCompilerHost({ noEmit: true, strict: true });
const originalGetSourceFile = host.getSourceFile.bind(host);
host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
  fileName === source.fileName
    ? source
    : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
const program = ts.createProgram({
  rootNames: [source.fileName],
  options: { noEmit: true, strict: true },
  host
});
const diagnostics = ts.getPreEmitDiagnostics(program).filter(
  diagnostic => diagnostic.category === ts.DiagnosticCategory.Error
);
if (diagnostics.length > 0) {
  throw new Error(
    `TypeScript API bridge produced diagnostics:\n${ts.formatDiagnostics(diagnostics, host)}`
  );
}

process.stdout.write(
  `typescript-api-lane:ok (bridge ${bridge.package}@${bridge.version}, `
    + `engine ${engine.package}@${ts.version})\n`
);
