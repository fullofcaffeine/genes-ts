"use strict";

const { types: utilTypes } = require("node:util");

const ts = require("typescript");

const PROTOCOL = "genes.css-module-typescript-declaration-adapter.v1";
const TYPESCRIPT_VERSION = "6.0.3";

class AdapterFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new AdapterFailure(code);
}

function compareUtf8(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

function record(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !utilTypes.isProxy(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function parseInput(input) {
  if (!record(input)) fail("invalid-input");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Object.getOwnPropertySymbols(input).length !== 0 ||
    Object.keys(descriptors).sort().join("\n") !==
      ["declarationPath", "protocol", "text"].join("\n")
  ) {
    fail("invalid-input");
  }
  const values = {};
  for (const key of ["declarationPath", "protocol", "text"]) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) fail("invalid-input");
    values[key] = descriptor.value;
  }
  if (
    values.protocol !== PROTOCOL ||
    typeof values.declarationPath !== "string" ||
    !values.declarationPath.endsWith(".module.css.d.ts") ||
    typeof values.text !== "string"
  ) {
    fail("invalid-input");
  }
  return values;
}

function hasOnlyModifier(node, kind) {
  const modifiers = ts.getModifiers(node);
  return modifiers !== undefined && modifiers.length === 1 && modifiers[0].kind === kind;
}

function propertyName(member) {
  const name = member.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    if (name.text.length === 0) fail("member-invalid");
    return name.text;
  }
  fail("member-invalid");
}

function syntaxDiagnostics(source, filename) {
  const options = {
    noEmit: true,
    noLib: true,
    target: ts.ScriptTarget.Latest,
  };
  const host = ts.createCompilerHost(options, true);
  host.fileExists = (candidate) => candidate === filename;
  host.readFile = (candidate) => (candidate === filename ? source.text : undefined);
  host.getSourceFile = (candidate) => (candidate === filename ? source : undefined);
  host.writeFile = () => {};
  const program = ts.createProgram([filename], options, host);
  return program.getSyntacticDiagnostics(source);
}

function declarationExports(source, declarationPath) {
  if (source.statements.length !== 2) fail("declaration-shape-invalid");
  const variableStatement = source.statements[0];
  const exportStatement = source.statements[1];
  if (
    !ts.isVariableStatement(variableStatement) ||
    !hasOnlyModifier(variableStatement, ts.SyntaxKind.DeclareKeyword) ||
    (variableStatement.declarationList.flags & ts.NodeFlags.Const) === 0 ||
    variableStatement.declarationList.declarations.length !== 1
  ) {
    fail("declaration-shape-invalid");
  }
  const declaration = variableStatement.declarationList.declarations[0];
  if (
    !ts.isIdentifier(declaration.name) ||
    declaration.exclamationToken !== undefined ||
    declaration.initializer !== undefined ||
    !ts.isTypeLiteralNode(declaration.type)
  ) {
    fail("declaration-shape-invalid");
  }
  if (
    !ts.isExportAssignment(exportStatement) ||
    exportStatement.isExportEquals ||
    !ts.isIdentifier(exportStatement.expression) ||
    exportStatement.expression.text !== declaration.name.text
  ) {
    fail("declaration-shape-invalid");
  }

  const names = new Set();
  const exports = [];
  for (const member of declaration.type.members) {
    if (
      !ts.isPropertySignature(member) ||
      member.initializer !== undefined ||
      member.questionToken !== undefined ||
      member.type?.kind !== ts.SyntaxKind.StringKeyword ||
      !hasOnlyModifier(member, ts.SyntaxKind.ReadonlyKeyword)
    ) {
      fail("member-invalid");
    }
    const name = propertyName(member);
    if (names.has(name)) fail("duplicate-member");
    names.add(name);
    const point = source.getLineAndCharacterOfPosition(member.name.getStart(source));
    exports.push({
      name,
      source: {
        path: declarationPath,
        line: point.line + 1,
        column: point.character + 1,
      },
    });
  }
  if (exports.length === 0) fail("exports-empty");
  return exports.sort((left, right) => compareUtf8(left.name, right.name));
}

function run(input) {
  if (ts.version !== TYPESCRIPT_VERSION) fail("processor-version-mismatch");
  const parsed = parseInput(input);
  const source = ts.createSourceFile(
    parsed.declarationPath,
    parsed.text,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  if (syntaxDiagnostics(source, parsed.declarationPath).length !== 0) {
    fail("syntax-invalid");
  }
  return {
    kind: "success",
    exports: declarationExports(source, parsed.declarationPath),
    processorId: "typescript",
    processorVersion: TYPESCRIPT_VERSION,
  };
}

exports.runGenesProcessor = async (input) => {
  try {
    return run(input);
  } catch (error) {
    return {
      kind: "failure",
      code: error instanceof AdapterFailure ? error.code : "declaration-invalid",
    };
  }
};
