import ts from "../typescript-api.js";

export type EffectiveModuleFormat = "esm" | "commonjs" | "other-lowered";

export type EffectiveImportShape =
  | "bare"
  | "empty"
  | "named"
  | "default"
  | "namespace"
  | "default-and-empty"
  | "default-and-named"
  | "default-and-namespace"
  | "commonjs"
  | "other-lowered";

export type EffectiveImportProvenance = {
  readonly sourceFile: string;
  readonly sourceOrdinal: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly sourceLine: number;
  readonly sourceColumn: number;
  readonly sourceText: string;
  readonly specifier: string;
};

export type EffectiveRuntimeRequest = EffectiveImportProvenance & {
  readonly disposition: "runtime-request";
  readonly requestOrdinal: number;
  readonly moduleFormat: EffectiveModuleFormat;
  readonly emittedShape: EffectiveImportShape;
  readonly emittedSyntaxKind: string;
  readonly emittedStatement: string;
};

export type EffectiveTypeOnlyImport = EffectiveImportProvenance & {
  readonly disposition: "type-only";
};

export type EffectiveElidedImport = EffectiveImportProvenance & {
  readonly disposition: "elided";
  readonly reason: "typescript-emit-elision";
};

export type EffectiveImportDisposition =
  | EffectiveRuntimeRequest
  | EffectiveTypeOnlyImport
  | EffectiveElidedImport;

export type EffectiveModuleRequestFile = {
  readonly sourceFile: string;
  readonly outputFile: string | null;
  readonly emittedJavaScript: string | null;
  readonly imports: readonly EffectiveImportDisposition[];
  readonly runtimeRequests: readonly EffectiveRuntimeRequest[];
};

export type EffectiveModuleRequestInventory = {
  readonly typescriptVersion: string;
  readonly files: readonly EffectiveModuleRequestFile[];
};

type RetainedRequest = {
  readonly requestOrdinal: number;
  readonly moduleFormat: EffectiveModuleFormat;
  readonly emittedShape: EffectiveImportShape;
  readonly emittedSyntaxKind: string;
  readonly emittedStatement: string;
};

type SourceInventory = {
  readonly originalImports: readonly ts.ImportDeclaration[];
  readonly originalKeys: ReadonlySet<string>;
  readonly retained: Map<string, RetainedRequest>;
  outputFile: string | null;
  emittedJavaScript: string | null;
};

function importKey(node: ts.ImportDeclaration): string {
  return `${node.pos}:${node.end}`;
}

function importSpecifier(node: ts.ImportDeclaration): string {
  if (!ts.isStringLiteralLike(node.moduleSpecifier)) {
    throw new Error(
      "TS2HX-ESM-REQUEST-INVENTORY-001: import module specifiers must be string literals"
    );
  }
  return node.moduleSpecifier.text;
}

function emittedImportShape(node: ts.ImportDeclaration): EffectiveImportShape {
  const clause = node.importClause;
  if (!clause) return "bare";

  const hasDefault = clause.name !== undefined;
  const bindings = clause.namedBindings;
  if (!bindings) return hasDefault ? "default" : "empty";
  if (ts.isNamespaceImport(bindings)) {
    return hasDefault ? "default-and-namespace" : "namespace";
  }

  const hasNamedBindings = bindings.elements.length > 0;
  if (hasDefault) return hasNamedBindings ? "default-and-named" : "default-and-empty";
  return hasNamedBindings ? "named" : "empty";
}

function emittedModuleFormat(
  program: ts.Program,
  original: ts.ImportDeclaration,
  transformed: ts.Statement
): EffectiveModuleFormat {
  if (ts.isImportDeclaration(transformed)) return "esm";

  const sourceFile = original.getSourceFile();
  const mode = ts.isStringLiteralLike(original.moduleSpecifier)
    ? program.getModeForUsageLocation(sourceFile, original.moduleSpecifier)
    : undefined;
  if (mode === ts.ModuleKind.CommonJS) return "commonjs";
  if (program.getCompilerOptions().module === ts.ModuleKind.CommonJS) return "commonjs";
  return "other-lowered";
}

function emittedShape(statement: ts.Statement): EffectiveImportShape {
  if (ts.isImportDeclaration(statement)) return emittedImportShape(statement);
  return "commonjs";
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map(diagnostic => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      return `TS${diagnostic.code}: ${message}`;
    })
    .join("\n");
}

function provenance(
  sourceFile: ts.SourceFile,
  node: ts.ImportDeclaration,
  sourceOrdinal: number
): EffectiveImportProvenance {
  const sourceStart = node.getStart(sourceFile);
  const sourceEnd = node.getEnd();
  const location = sourceFile.getLineAndCharacterOfPosition(sourceStart);
  return {
    sourceFile: sourceFile.fileName,
    sourceOrdinal,
    sourceStart,
    sourceEnd,
    sourceLine: location.line + 1,
    sourceColumn: location.character + 1,
    sourceText: sourceFile.text.slice(sourceStart, sourceEnd),
    specifier: importSpecifier(node)
  };
}

function isJavaScriptOutput(fileName: string): boolean {
  return /\.(?:[cm]?js|jsx)$/.test(fileName);
}

/**
 * Observes the configured TypeScript emitter's effective module requests.
 *
 * Why: source import syntax is not a runtime-request inventory. TypeScript may
 * erase unused bindings, preserve an otherwise empty request under
 * `verbatimModuleSyntax`, or lower the same declaration to CommonJS. Repeating
 * those rules in ts2hx would drift from the exact compiler configuration that
 * users asked TypeScript to enforce.
 *
 * What: every original static import receives one deterministic disposition:
 * a retained runtime request in final emit order, a declaration-wide type-only
 * import, or an import removed by TypeScript emit. Retained statements keep the
 * original source span and record whether the configured emit was ESM,
 * CommonJS, or another lowering.
 *
 * How: a read-only `after` transformer sees JavaScript after TypeScript's
 * built-in import elision and module transform. `ts.getOriginalNode` links each
 * surviving top-level statement back to its source `ImportDeclaration`. Output
 * is captured in memory, so this evidence pass never publishes compiler files.
 * The supplied Program must be error-free and emit-capable; production use may
 * later create an equivalent shadow Program when a user tsconfig sets
 * output-only flags such as `noEmit`.
 */
export function inspectEffectiveModuleRequests(
  program: ts.Program,
  sourceFiles: readonly ts.SourceFile[]
): EffectiveModuleRequestInventory {
  const compilerOptions = program.getCompilerOptions();
  if (compilerOptions.noEmit || compilerOptions.emitDeclarationOnly) {
    throw new Error(
      "TS2HX-ESM-REQUEST-INVENTORY-002: the evidence Program must emit JavaScript"
    );
  }

  const errors = ts.getPreEmitDiagnostics(program).filter(
    diagnostic => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (errors.length > 0) {
    throw new Error(
      "TS2HX-ESM-REQUEST-INVENTORY-003: TypeScript must type-check before request inspection\n"
        + formatDiagnostics(errors)
    );
  }

  const inventories = new Map<string, SourceInventory>();
  for (const sourceFile of sourceFiles) {
    if (inventories.has(sourceFile.fileName)) {
      throw new Error(
        `TS2HX-ESM-REQUEST-INVENTORY-004: duplicate source file ${sourceFile.fileName}`
      );
    }
    const originalImports = sourceFile.statements.filter(ts.isImportDeclaration);
    inventories.set(sourceFile.fileName, {
      originalImports,
      originalKeys: new Set(originalImports.map(importKey)),
      retained: new Map(),
      outputFile: null,
      emittedJavaScript: null
    });
  }

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const inspectAfter: ts.TransformerFactory<ts.SourceFile> = () => transformedFile => {
    const inventory = inventories.get(transformedFile.fileName);
    if (!inventory) return transformedFile;

    let requestOrdinal = 0;
    for (const statement of transformedFile.statements) {
      const original = ts.getOriginalNode(statement, ts.isImportDeclaration);
      if (!original) continue;
      const key = importKey(original);
      if (!inventory.originalKeys.has(key) || inventory.retained.has(key)) continue;

      const moduleFormat = emittedModuleFormat(program, original, statement);
      inventory.retained.set(key, {
        requestOrdinal,
        moduleFormat,
        emittedShape: moduleFormat === "commonjs"
          ? "commonjs"
          : moduleFormat === "esm"
            ? emittedShape(statement)
            : "other-lowered",
        emittedSyntaxKind: ts.SyntaxKind[statement.kind] ?? `SyntaxKind(${statement.kind})`,
        emittedStatement: printer.printNode(
          ts.EmitHint.Unspecified,
          statement,
          transformedFile
        )
      });
      requestOrdinal += 1;
    }
    return transformedFile;
  };

  const writeFile: ts.WriteFileCallback = (fileName, text, _bom, _onError, emittedSources) => {
    if (!isJavaScriptOutput(fileName)) return;
    for (const emittedSource of emittedSources ?? []) {
      const inventory = inventories.get(emittedSource.fileName);
      if (!inventory) continue;
      inventory.outputFile = fileName;
      inventory.emittedJavaScript = text;
    }
  };

  const emitResult = program.emit(
    undefined,
    writeFile,
    undefined,
    false,
    { after: [inspectAfter] }
  );
  const emitErrors = emitResult.diagnostics.filter(
    diagnostic => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (emitResult.emitSkipped || emitErrors.length > 0) {
    throw new Error(
      "TS2HX-ESM-REQUEST-INVENTORY-005: TypeScript skipped the evidence emit"
        + (emitErrors.length > 0 ? `\n${formatDiagnostics(emitErrors)}` : "")
    );
  }

  return {
    typescriptVersion: ts.version,
    files: sourceFiles.map(sourceFile => {
      const inventory = inventories.get(sourceFile.fileName);
      if (!inventory) {
        throw new Error(
          `TS2HX-ESM-REQUEST-INVENTORY-006: missing source inventory ${sourceFile.fileName}`
        );
      }
      const imports: EffectiveImportDisposition[] = inventory.originalImports.map(
        (node, sourceOrdinal) => {
          const retained = inventory.retained.get(importKey(node));
          const source = provenance(sourceFile, node, sourceOrdinal);
          if (retained) {
            return {
              ...source,
              disposition: "runtime-request",
              ...retained
            };
          }
          if (node.importClause?.isTypeOnly) {
            return { ...source, disposition: "type-only" };
          }
          return {
            ...source,
            disposition: "elided",
            reason: "typescript-emit-elision"
          };
        }
      );
      const runtimeRequests = imports.filter(
        (entry): entry is EffectiveRuntimeRequest => entry.disposition === "runtime-request"
      );
      return {
        sourceFile: sourceFile.fileName,
        outputFile: inventory.outputFile,
        emittedJavaScript: inventory.emittedJavaScript,
        imports,
        runtimeRequests
      };
    })
  };
}
