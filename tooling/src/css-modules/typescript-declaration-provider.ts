import ts from "typescript";

import { canonicalDigest } from "../artifacts/canonical-json.js";
import { validateCssModuleExportsManifest } from "./companion.js";
import { cssModuleFailure } from "./error.js";
import {
  providerProjectRoot,
  providerRelativePath,
  readProviderFile,
} from "./provider-files.js";
import {
  CSS_MODULE_EXPORTS_PROTOCOL,
  CSS_MODULE_EXPORTS_VERSION,
  CSS_MODULE_NAMING_POLICY,
  type CssModuleBinding,
  type CssModuleExport,
  type CssModuleExportsManifestV1,
} from "./types.js";

const TYPESCRIPT_VERSION = "6.0.3";
const TYPESCRIPT_INTEGRITY =
  "sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==";

export interface TypeScriptDeclarationManifestOptions {
  readonly projectRoot: string;
  readonly entry: string;
  readonly declaration: string;
  readonly binding: CssModuleBinding;
}

function declarationFailure(message: string, subject: string): never {
  return cssModuleFailure(
    "GENES-CSS-MODULE-DECLARATION-017",
    message,
    subject,
  );
}

function hasOnlyModifier(
  node: ts.HasModifiers,
  kind: ts.SyntaxKind,
): boolean {
  const modifiers = ts.getModifiers(node);
  return modifiers !== undefined && modifiers.length === 1 && modifiers[0]?.kind === kind;
}

function propertyName(
  member: ts.PropertySignature,
  declarationPath: string,
): string {
  const name = member.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    if (name.text.length === 0) {
      return declarationFailure("CSS Module declaration keys must not be empty.", declarationPath);
    }
    return name.text;
  }
  return declarationFailure(
    "CSS Module declarations accept only identifier or string-literal property names.",
    declarationPath,
  );
}

function declarationExports(
  source: ts.SourceFile,
  declarationPath: string,
): readonly CssModuleExport[] {
  if (source.statements.length !== 2) {
    return declarationFailure(
      "The declaration must contain exactly one declared const type literal " +
        "and its default export.",
      declarationPath,
    );
  }
  const variableStatement = source.statements[0];
  const exportStatement = source.statements[1];
  if (
    variableStatement === undefined ||
    !ts.isVariableStatement(variableStatement) ||
    !hasOnlyModifier(variableStatement, ts.SyntaxKind.DeclareKeyword) ||
    (variableStatement.declarationList.flags & ts.NodeFlags.Const) === 0 ||
    variableStatement.declarationList.declarations.length !== 1
  ) {
    return declarationFailure(
      "The first statement must be one `declare const` with a closed type literal.",
      declarationPath,
    );
  }
  const declaration = variableStatement.declarationList.declarations[0];
  if (
    declaration === undefined ||
    !ts.isIdentifier(declaration.name) ||
    declaration.initializer !== undefined ||
    declaration.type === undefined ||
    !ts.isTypeLiteralNode(declaration.type)
  ) {
    return declarationFailure(
      "The declared const must have one direct object type literal and no initializer.",
      declarationPath,
    );
  }
  if (
    exportStatement === undefined ||
    !ts.isExportAssignment(exportStatement) ||
    exportStatement.isExportEquals ||
    !ts.isIdentifier(exportStatement.expression) ||
    exportStatement.expression.text !== declaration.name.text
  ) {
    return declarationFailure(
      "The second statement must default-export the declared const.",
      declarationPath,
    );
  }

  const names = new Set<string>();
  const exports: CssModuleExport[] = [];
  for (const member of declaration.type.members) {
    if (
      !ts.isPropertySignature(member) ||
      member.questionToken !== undefined ||
      member.type?.kind !== ts.SyntaxKind.StringKeyword ||
      !hasOnlyModifier(member, ts.SyntaxKind.ReadonlyKeyword)
    ) {
      return declarationFailure(
        "Every CSS Module declaration member must be a required readonly " +
          "named property whose type is exactly string.",
        declarationPath,
      );
    }
    const name = propertyName(member, declarationPath);
    if (names.has(name)) {
      return declarationFailure(
        `CSS Module declaration key ${JSON.stringify(name)} appears more than once.`,
        declarationPath,
      );
    }
    names.add(name);
    const point = source.getLineAndCharacterOfPosition(member.name.getStart(source));
    exports.push({
      name,
      source: { path: declarationPath, line: point.line + 1, column: point.character + 1 },
    });
  }
  return exports;
}

/** Converts one finite per-file TypeScript declaration into the v1 manifest. */
export function createTypeScriptDeclarationManifest(
  options: TypeScriptDeclarationManifestOptions,
): CssModuleExportsManifestV1 {
  const root = providerProjectRoot(options.projectRoot);
  const entryPath = providerRelativePath(options.entry, "entry");
  const declarationPath = providerRelativePath(options.declaration, "declaration");
  if (!entryPath.endsWith(".module.css") || declarationPath !== `${entryPath}.d.ts`) {
    return declarationFailure(
      "declaration must be the exact per-file path `<entry>.d.ts` for one .module.css entry.",
      "declaration",
    );
  }
  if (ts.version !== TYPESCRIPT_VERSION) {
    return declarationFailure(
      `The declaration adapter requires pinned TypeScript ` +
        `${TYPESCRIPT_VERSION}, but loaded ${ts.version}.`,
      "typescript",
    );
  }
  const entry = readProviderFile(root, entryPath, "entry");
  const declaration = readProviderFile(root, declarationPath, "declaration");
  const syntax = ts.transpileModule(declaration.text, {
    compilerOptions: { target: ts.ScriptTarget.Latest },
    fileName: `${entryPath}.syntax.ts`,
    reportDiagnostics: true,
  });
  if (syntax.diagnostics !== undefined && syntax.diagnostics.length > 0) {
    return declarationFailure(
      "The CSS Module declaration must contain syntactically valid TypeScript.",
      declarationPath,
    );
  }
  const source = ts.createSourceFile(
    declarationPath,
    declaration.text,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const exports = declarationExports(source, declarationPath);
  return validateCssModuleExportsManifest({
    protocol: CSS_MODULE_EXPORTS_PROTOCOL,
    version: CSS_MODULE_EXPORTS_VERSION,
    namingPolicy: CSS_MODULE_NAMING_POLICY,
    binding: options.binding,
    source: {
      entry: entryPath,
      inputs: [entry.input, declaration.input],
    },
    producer: {
      providerId: "@genes-ts/tooling/css-modules/typescript-declaration",
      providerVersion: "1",
      processorId: "typescript",
      processorVersion: TYPESCRIPT_VERSION,
      processorIntegrity: TYPESCRIPT_INTEGRITY,
      configurationSha256: canonicalDigest({
        providerProtocol: 1,
        declarationShape: "declare-const-closed-readonly-string-literal-default-export",
        typescriptVersion: TYPESCRIPT_VERSION,
      }),
    },
    exports,
  });
}
