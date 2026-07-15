import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export type ExportedSurfaceFindingKind = "any" | "unknown" | "string-index" | "number-index";

export interface ExportedSurfaceFinding {
  readonly kind: ExportedSurfaceFindingKind;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly exportName: string;
  readonly surfacePath: string;
  readonly renderedType: string;
}

export interface ExportedSurfaceAuditOptions {
  readonly repoRoot: string;
  readonly tsconfigPath: string;
  readonly includePaths: ReadonlyArray<string>;
}

export interface ExportedSurfacePolicyOptions extends ExportedSurfaceAuditOptions {
  readonly scope: string;
  readonly boundaryManifestPath?: string;
}

interface BoundaryMatch {
  readonly file: string;
  readonly export: string;
  readonly pathPrefix?: string;
  readonly kinds: ReadonlyArray<ExportedSurfaceFindingKind>;
}

interface ExportedSurfaceBoundary {
  readonly id: string;
  readonly scope: string;
  readonly owner: string;
  readonly reason: string;
  readonly source: string;
  readonly match: BoundaryMatch;
}

interface BoundaryManifest {
  readonly version: 1;
  readonly boundaries: ReadonlyArray<ExportedSurfaceBoundary>;
}

interface ExportRoot {
  readonly exportName: string;
  readonly declaration: ts.Declaration;
  readonly sourceFile: ts.SourceFile;
}

interface AuditContext {
  readonly checker: ts.TypeChecker;
  readonly repoRoot: string;
  readonly isIncluded: (sourceFile: ts.SourceFile) => boolean;
  readonly findings: ExportedSurfaceFinding[];
  readonly findingKeys: Set<string>;
  readonly activeTypes: Set<ts.Type>;
}

/**
 * Audits the resolved public type graph emitted by genes-ts and classic Genes.
 *
 * Why: lexical searches cannot see `any` inherited from an import, inferred by
 * TypeScript, or hidden inside an exported generic. A successful `tsc` run is
 * also insufficient because `any` deliberately accepts invalid consumers.
 *
 * What: the audit starts at every export in explicitly selected generated
 * modules, follows public signatures and locally declared structural members,
 * and reports `any`, `unknown`, and explicit string/number index signatures.
 * External library implementations are not expanded, but their public type
 * arguments are inspected so shapes such as `Promise<any>` remain visible.
 *
 * How: TypeScript's Program and TypeChecker are the semantic oracle. Traversal
 * is cycle-safe, findings are deterministic, and source positions identify the
 * exported root through which a weak type escaped. This deliberately remains a
 * release gate, not compiler behavior: it cannot change emitted source.
 */
export function auditExportedSurfaces(options: ExportedSurfaceAuditOptions): ReadonlyArray<ExportedSurfaceFinding> {
  const repoRoot = path.resolve(options.repoRoot);
  const configPath = path.resolve(repoRoot, options.tsconfigPath);
  const program = loadProgram(configPath);
  const checker = program.getTypeChecker();
  const isIncluded = createSourceMatcher(repoRoot, options.includePaths);
  const findings: ExportedSurfaceFinding[] = [];
  const context: AuditContext = {
    checker,
    repoRoot,
    isIncluded,
    findings,
    findingKeys: new Set<string>(),
    activeTypes: new Set<ts.Type>()
  };

  for (const sourceFile of program.getSourceFiles().filter(isIncluded).sort(compareSourceFiles)) {
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol === undefined) continue;

    const exportedSymbols = checker
      .getExportsOfModule(moduleSymbol)
      .slice()
      .sort((left, right) => left.getName().localeCompare(right.getName()));

    for (const exportedSymbol of exportedSymbols) {
      const target = resolveAlias(checker, exportedSymbol);
      const declaration = exportDeclarationInFile(exportedSymbol, sourceFile)
        ?? target.valueDeclaration
        ?? target.declarations?.[0];
      if (declaration === undefined) continue;

      const root: ExportRoot = {
        exportName: exportedSymbol.getName(),
        declaration,
        sourceFile
      };

      if ((target.flags & ts.SymbolFlags.Type) !== 0) {
        visitType(context, checker.getDeclaredTypeOfSymbol(target), `${root.exportName}<type>`, root);
      }
      if ((target.flags & ts.SymbolFlags.Value) !== 0) {
        visitType(
          context,
          checker.getTypeOfSymbolAtLocation(target, declaration),
          `${root.exportName}<value>`,
          root
        );
      }
      for (const targetDeclaration of target.declarations ?? []) {
        if (context.isIncluded(targetDeclaration.getSourceFile())) {
          visitDeclarationTypeSyntax(context, targetDeclaration, `${root.exportName}<syntax>`, root);
        }
      }
    }
  }

  return findings.sort(compareFindings);
}

/**
 * Enforces explicit provenance for the small number of intentional weak APIs.
 *
 * Boundary entries are exact by file/export/kind and may narrow further by a
 * semantic path prefix. Every active entry must match at least one finding;
 * stale entries therefore cannot become permanent blanket exemptions. A
 * finding matching multiple entries is rejected because ownership would be
 * ambiguous.
 */
export function assertExportedSurfacePolicy(options: ExportedSurfacePolicyOptions): void {
  const findings = auditExportedSurfaces(options);
  const manifest = options.boundaryManifestPath === undefined
    ? { version: 1 as const, boundaries: [] }
    : readBoundaryManifest(options.repoRoot, options.boundaryManifestPath);
  const activeBoundaries = manifest.boundaries.filter(boundary => boundary.scope === options.scope);
  const usedBoundaryIds = new Set<string>();
  const violations: string[] = [];

  for (const finding of findings) {
    const matches = activeBoundaries.filter(boundary => boundaryMatches(boundary.match, finding));
    if (matches.length === 0) {
      violations.push(`unapproved ${formatFinding(finding)}`);
      continue;
    }
    if (matches.length > 1) {
      violations.push(
        `ambiguous ${formatFinding(finding)} (matches ${matches.map(boundary => boundary.id).join(", ")})`
      );
      continue;
    }
    usedBoundaryIds.add(matches[0].id);
  }

  for (const boundary of activeBoundaries) {
    if (!usedBoundaryIds.has(boundary.id)) {
      violations.push(`stale boundary ${boundary.id} (${boundary.match.file}#${boundary.match.export})`);
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Exported-surface policy failed for scope ${JSON.stringify(options.scope)}:\n${violations
        .map(violation => `  - ${violation}`)
        .join("\n")}`
    );
  }
}

function loadProgram(configPath: string): ts.Program {
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error !== undefined) {
    throw new Error(formatDiagnostics([loaded.error]));
  }

  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath
  );
  if (parsed.errors.length > 0) {
    throw new Error(formatDiagnostics(parsed.errors));
  }

  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences
  });
}

function formatDiagnostics(diagnostics: ReadonlyArray<ts.Diagnostic>): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: fileName => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n"
  });
}

function createSourceMatcher(repoRoot: string, includePaths: ReadonlyArray<string>): (sourceFile: ts.SourceFile) => boolean {
  if (includePaths.length === 0) {
    throw new Error("Exported-surface audit requires at least one explicit include path.");
  }

  const includes = includePaths.map(includePath => {
    const absolutePath = path.resolve(repoRoot, includePath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Exported-surface include path does not exist: ${includePath}`);
    }
    return {
      absolutePath,
      isDirectory: statSync(absolutePath).isDirectory()
    };
  });

  return sourceFile => {
    const sourcePath = path.resolve(sourceFile.fileName);
    return includes.some(include => include.isDirectory
      ? sourcePath === include.absolutePath || sourcePath.startsWith(`${include.absolutePath}${path.sep}`)
      : sourcePath === include.absolutePath);
  };
}

function compareSourceFiles(left: ts.SourceFile, right: ts.SourceFile): number {
  return left.fileName.localeCompare(right.fileName);
}

function resolveAlias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
}

function exportDeclarationInFile(symbol: ts.Symbol, sourceFile: ts.SourceFile): ts.Declaration | undefined {
  return symbol.declarations?.find(declaration => declaration.getSourceFile() === sourceFile);
}

function visitType(context: AuditContext, type: ts.Type, surfacePath: string, root: ExportRoot): void {
  if ((type.flags & ts.TypeFlags.Any) !== 0) {
    addFinding(context, "any", type, surfacePath, root);
    return;
  }
  if ((type.flags & ts.TypeFlags.Unknown) !== 0) {
    addFinding(context, "unknown", type, surfacePath, root);
    return;
  }
  if (context.activeTypes.has(type)) return;

  context.activeTypes.add(type);
  try {
    if (type.isUnionOrIntersection()) {
      type.types.forEach((member, index) => visitType(context, member, `${surfacePath}.member[${index}]`, root));
    }

    (type.aliasTypeArguments ?? []).forEach((argument, index) =>
      visitType(context, argument, `${surfacePath}.aliasArg[${index}]`, root)
    );

    if ((type.flags & ts.TypeFlags.Object) !== 0) {
      const objectType = type as ts.ObjectType;
      if ((objectType.objectFlags & ts.ObjectFlags.Reference) !== 0) {
        context.checker
          .getTypeArguments(objectType as ts.TypeReference)
          .forEach((argument, index) => visitType(context, argument, `${surfacePath}.typeArg[${index}]`, root));
      }
    }

    if (type.isTypeParameter()) {
      const defaultType = context.checker.getDefaultFromTypeParameter(type);
      if (defaultType !== undefined) {
        visitType(context, defaultType, `${surfacePath}.default`, root);
      }
    }

    if ((type.flags & ts.TypeFlags.IndexedAccess) !== 0) {
      const indexedAccess = type as ts.IndexedAccessType;
      visitType(context, indexedAccess.objectType, `${surfacePath}.indexedObject`, root);
      visitType(context, indexedAccess.indexType, `${surfacePath}.indexedKey`, root);
      if (indexedAccess.constraint !== undefined) {
        visitType(context, indexedAccess.constraint, `${surfacePath}.indexedConstraint`, root);
      }
    }

    if (type.isIndexType()) {
      visitType(context, type.type, `${surfacePath}.keyof`, root);
    }

    if ((type.flags & ts.TypeFlags.Conditional) !== 0) {
      const conditional = type as ts.ConditionalType;
      visitType(context, conditional.checkType, `${surfacePath}.conditionalCheck`, root);
      visitType(context, conditional.extendsType, `${surfacePath}.conditionalExtends`, root);
      visitType(
        context,
        conditional.resolvedTrueType ?? context.checker.getTypeFromTypeNode(conditional.root.node.trueType),
        `${surfacePath}.conditionalTrue`,
        root
      );
      visitType(
        context,
        conditional.resolvedFalseType ?? context.checker.getTypeFromTypeNode(conditional.root.node.falseType),
        `${surfacePath}.conditionalFalse`,
        root
      );
    }

    if ((type.flags & ts.TypeFlags.Substitution) !== 0) {
      const substitution = type as ts.SubstitutionType;
      visitType(context, substitution.baseType, `${surfacePath}.substitutionBase`, root);
      visitType(context, substitution.constraint, `${surfacePath}.substitutionConstraint`, root);
    }

    if ((type.flags & ts.TypeFlags.TemplateLiteral) !== 0) {
      (type as ts.TemplateLiteralType).types.forEach((member, index) =>
        visitType(context, member, `${surfacePath}.templateType[${index}]`, root)
      );
    }

    if ((type.flags & ts.TypeFlags.StringMapping) !== 0) {
      visitType(context, (type as ts.StringMappingType).type, `${surfacePath}.stringMapping`, root);
    }

    const constraint = context.checker.getBaseConstraintOfType(type);
    if (constraint !== undefined && constraint !== type) {
      visitType(context, constraint, `${surfacePath}.constraint`, root);
    }

    if (!shouldExpandLocalStructure(context, type)) return;

    for (const indexInfo of context.checker.getIndexInfosOfType(type)) {
      if (indexInfo.declaration === undefined || !context.isIncluded(indexInfo.declaration.getSourceFile())) continue;
      const indexKind = classifyIndexKind(indexInfo.keyType);
      if (indexKind !== undefined) {
        addFinding(context, indexKind, indexInfo.type, `${surfacePath}.[${renderType(context, indexInfo.keyType)}]`, root);
      }
      visitType(context, indexInfo.type, `${surfacePath}.indexValue`, root);
    }

    visitSignatures(context, type, ts.SignatureKind.Call, "call", surfacePath, root);
    visitSignatures(context, type, ts.SignatureKind.Construct, "construct", surfacePath, root);

    for (const property of context.checker.getPropertiesOfType(type)) {
      const declarations = property.declarations ?? [];
      const localDeclarations = declarations.filter(declaration => context.isIncluded(declaration.getSourceFile()));
      if (localDeclarations.length === 0 || localDeclarations.every(isNonPublicDeclaration)) continue;
      const declaration = property.valueDeclaration ?? localDeclarations[0];
      visitType(
        context,
        context.checker.getTypeOfSymbolAtLocation(property, declaration),
        `${surfacePath}.${property.getName()}`,
        root
      );
    }
  } finally {
    context.activeTypes.delete(type);
  }
}

function shouldExpandLocalStructure(context: AuditContext, type: ts.Type): boolean {
  const declarations = [
    ...(type.aliasSymbol?.declarations ?? []),
    ...(type.symbol?.declarations ?? [])
  ];
  return declarations.some(declaration => context.isIncluded(declaration.getSourceFile()));
}

function visitSignatures(
  context: AuditContext,
  type: ts.Type,
  kind: ts.SignatureKind,
  label: string,
  surfacePath: string,
  root: ExportRoot
): void {
  context.checker.getSignaturesOfType(type, kind).forEach((signature, signatureIndex) => {
    const declaration = signature.getDeclaration();
    if (declaration === undefined || !context.isIncluded(declaration.getSourceFile())) return;
    const signaturePath = `${surfacePath}.${label}[${signatureIndex}]`;

    for (const typeParameter of signature.getTypeParameters() ?? []) {
      const constraint = context.checker.getBaseConstraintOfType(typeParameter);
      if (constraint !== undefined) {
        visitType(context, constraint, `${signaturePath}.typeParameter(${typeParameter.symbol?.getName() ?? "?"})`, root);
      }
    }

    signature.getParameters().forEach((parameter, parameterIndex) => {
      const parameterDeclaration = parameter.valueDeclaration ?? parameter.declarations?.[0] ?? declaration;
      visitType(
        context,
        context.checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration),
        `${signaturePath}.parameter(${parameter.getName() || parameterIndex.toString()})`,
        root
      );
    });

    visitType(context, signature.getReturnType(), `${signaturePath}.return`, root);
  });
}

/**
 * Complements resolved-type traversal for generic type forms that TypeScript
 * intentionally leaves deferred. A mapped type such as
 * `{ [K in keyof T]: any }` has no concrete properties until instantiation, so
 * its public `any` is visible in the checked type syntax but not yet in the
 * symbol table. Only declaration signatures are visited; implementation bodies
 * and initializers are excluded because they are not exported API.
 */
function visitDeclarationTypeSyntax(
  context: AuditContext,
  declaration: ts.Declaration,
  surfacePath: string,
  root: ExportRoot
): void {
  if (ts.isTypeAliasDeclaration(declaration)) {
    visitTypeParametersSyntax(context, declaration.typeParameters, `${surfacePath}.typeParameter`, root);
    visitTypeNodeTree(context, declaration.type, `${surfacePath}.alias`, root);
    return;
  }

  if (ts.isInterfaceDeclaration(declaration)) {
    visitTypeParametersSyntax(context, declaration.typeParameters, `${surfacePath}.typeParameter`, root);
    visitHeritageSyntax(context, declaration.heritageClauses, `${surfacePath}.heritage`, root);
    declaration.members.forEach((member, index) =>
      visitNestedTypeNodes(context, member, `${surfacePath}.member[${index}]`, root)
    );
    return;
  }

  if (ts.isClassDeclaration(declaration)) {
    visitTypeParametersSyntax(context, declaration.typeParameters, `${surfacePath}.typeParameter`, root);
    visitHeritageSyntax(context, declaration.heritageClauses, `${surfacePath}.heritage`, root);
    declaration.members.forEach((member, index) => {
      if (isNonPublicDeclaration(member) || (member.name !== undefined && ts.isPrivateIdentifier(member.name))) return;
      visitClassElementTypeSyntax(context, member, `${surfacePath}.member[${index}]`, root);
    });
    return;
  }

  if (ts.isFunctionDeclaration(declaration)) {
    visitCallableTypeSyntax(context, declaration, `${surfacePath}.function`, root);
    return;
  }

  if (ts.isVariableDeclaration(declaration) && declaration.type !== undefined) {
    visitTypeNodeTree(context, declaration.type, `${surfacePath}.variable`, root);
  }
}

function visitClassElementTypeSyntax(
  context: AuditContext,
  member: ts.ClassElement,
  surfacePath: string,
  root: ExportRoot
): void {
  if (ts.isMethodDeclaration(member)
    || ts.isGetAccessorDeclaration(member)
    || ts.isSetAccessorDeclaration(member)
    || ts.isConstructorDeclaration(member)) {
    visitCallableTypeSyntax(context, member, surfacePath, root);
    return;
  }

  if (ts.isPropertyDeclaration(member) && member.type !== undefined) {
    visitTypeNodeTree(context, member.type, `${surfacePath}.property`, root);
  }
}

function visitCallableTypeSyntax(
  context: AuditContext,
  declaration: ts.SignatureDeclarationBase,
  surfacePath: string,
  root: ExportRoot
): void {
  visitTypeParametersSyntax(context, declaration.typeParameters, `${surfacePath}.typeParameter`, root);
  declaration.parameters.forEach((parameter, index) => {
    if (parameter.type !== undefined) {
      visitTypeNodeTree(context, parameter.type, `${surfacePath}.parameter[${index}]`, root);
    }
  });
  if (declaration.type !== undefined) {
    visitTypeNodeTree(context, declaration.type, `${surfacePath}.return`, root);
  }
}

function visitTypeParametersSyntax(
  context: AuditContext,
  typeParameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined,
  surfacePath: string,
  root: ExportRoot
): void {
  typeParameters?.forEach((typeParameter, index) => {
    if (typeParameter.constraint !== undefined) {
      visitTypeNodeTree(context, typeParameter.constraint, `${surfacePath}[${index}].constraint`, root);
    }
    if (typeParameter.default !== undefined) {
      visitTypeNodeTree(context, typeParameter.default, `${surfacePath}[${index}].default`, root);
    }
  });
}

function visitHeritageSyntax(
  context: AuditContext,
  heritageClauses: ts.NodeArray<ts.HeritageClause> | undefined,
  surfacePath: string,
  root: ExportRoot
): void {
  heritageClauses?.forEach((clause, clauseIndex) => {
    clause.types.forEach((heritageType, typeIndex) => {
      heritageType.typeArguments?.forEach((argument, argumentIndex) =>
        visitTypeNodeTree(
          context,
          argument,
          `${surfacePath}[${clauseIndex}].type[${typeIndex}].argument[${argumentIndex}]`,
          root
        )
      );
    });
  });
}

function visitTypeNodeTree(
  context: AuditContext,
  node: ts.TypeNode,
  surfacePath: string,
  root: ExportRoot
): void {
  visitType(context, context.checker.getTypeFromTypeNode(node), surfacePath, root);
  visitNestedTypeNodes(context, node, surfacePath, root);
}

function visitNestedTypeNodes(
  context: AuditContext,
  node: ts.Node,
  surfacePath: string,
  root: ExportRoot
): void {
  let childIndex = 0;
  ts.forEachChild(node, child => {
    const childPath = `${surfacePath}.${ts.SyntaxKind[child.kind]}[${childIndex}]`;
    childIndex += 1;
    if (ts.isTypeNode(child)) {
      visitTypeNodeTree(context, child, childPath, root);
    } else {
      visitNestedTypeNodes(context, child, childPath, root);
    }
  });
}

function isNonPublicDeclaration(declaration: ts.Declaration): boolean {
  const flags = ts.getCombinedModifierFlags(declaration);
  return (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0;
}

function classifyIndexKind(keyType: ts.Type): ExportedSurfaceFindingKind | undefined {
  if ((keyType.flags & ts.TypeFlags.StringLike) !== 0) return "string-index";
  if ((keyType.flags & ts.TypeFlags.NumberLike) !== 0) return "number-index";
  return undefined;
}

function addFinding(
  context: AuditContext,
  kind: ExportedSurfaceFindingKind,
  type: ts.Type,
  surfacePath: string,
  root: ExportRoot
): void {
  const relativeFile = normalizePath(path.relative(context.repoRoot, root.sourceFile.fileName));
  const position = root.sourceFile.getLineAndCharacterOfPosition(root.declaration.getStart(root.sourceFile, false));
  const finding: ExportedSurfaceFinding = {
    kind,
    file: relativeFile,
    line: position.line + 1,
    column: position.character + 1,
    exportName: root.exportName,
    surfacePath,
    renderedType: renderType(context, type)
  };
  const key = [finding.file, finding.exportName, finding.surfacePath, finding.kind].join("\0");
  if (context.findingKeys.has(key)) return;
  context.findingKeys.add(key);
  context.findings.push(finding);
}

function renderType(context: AuditContext, type: ts.Type): string {
  return context.checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
}

function compareFindings(left: ExportedSurfaceFinding, right: ExportedSurfaceFinding): number {
  return left.file.localeCompare(right.file)
    || left.exportName.localeCompare(right.exportName)
    || left.surfacePath.localeCompare(right.surfacePath)
    || left.kind.localeCompare(right.kind);
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function formatFinding(finding: ExportedSurfaceFinding): string {
  return `${finding.kind} at ${finding.file}:${finding.line}:${finding.column} `
    + `${finding.exportName} via ${finding.surfacePath} (${finding.renderedType})`;
}

function boundaryMatches(match: BoundaryMatch, finding: ExportedSurfaceFinding): boolean {
  return normalizePath(match.file) === finding.file
    && match.export === finding.exportName
    && match.kinds.includes(finding.kind)
    && (match.pathPrefix === undefined || finding.surfacePath.startsWith(match.pathPrefix));
}

/**
 * Parses the only intentionally dynamic input in this gate: checked-in JSON.
 * Every field is validated before it becomes policy so malformed manifests
 * cannot silently approve a compiler boundary.
 */
function readBoundaryManifest(repoRoot: string, manifestPath: string): BoundaryManifest {
  const absolutePath = path.resolve(repoRoot, manifestPath);
  const parsed: unknown = JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
  const record = requireRecord(parsed, "manifest");
  if (record.version !== 1) throw new Error("Exported-surface boundary manifest version must be 1.");
  if (!Array.isArray(record.boundaries)) throw new Error("Boundary manifest must contain a boundaries array.");

  const seenIds = new Set<string>();
  const boundaries = record.boundaries.map((value, index): ExportedSurfaceBoundary => {
    const boundary = requireRecord(value, `boundaries[${index}]`);
    const id = requireString(boundary.id, `boundaries[${index}].id`);
    if (seenIds.has(id)) throw new Error(`Duplicate exported-surface boundary ID: ${id}`);
    seenIds.add(id);

    const source = requireString(boundary.source, `boundaries[${index}].source`);
    if (!existsSync(path.resolve(repoRoot, source))) {
      throw new Error(`Boundary ${id} provenance source does not exist: ${source}`);
    }

    const matchRecord = requireRecord(boundary.match, `boundaries[${index}].match`);
    if (!Array.isArray(matchRecord.kinds) || matchRecord.kinds.length === 0) {
      throw new Error(`Boundary ${id} must list at least one finding kind.`);
    }
    const kinds = matchRecord.kinds.map((kind, kindIndex) =>
      requireFindingKind(kind, `boundaries[${index}].match.kinds[${kindIndex}]`)
    );
    const pathPrefix = matchRecord.pathPrefix === undefined
      ? undefined
      : requireString(matchRecord.pathPrefix, `boundaries[${index}].match.pathPrefix`);

    return {
      id,
      scope: requireString(boundary.scope, `boundaries[${index}].scope`),
      owner: requireString(boundary.owner, `boundaries[${index}].owner`),
      reason: requireString(boundary.reason, `boundaries[${index}].reason`),
      source,
      match: {
        file: normalizePath(requireString(matchRecord.file, `boundaries[${index}].match.file`)),
        export: requireString(matchRecord.export, `boundaries[${index}].match.export`),
        pathPrefix,
        kinds
      }
    };
  });

  return { version: 1, boundaries };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireFindingKind(value: unknown, label: string): ExportedSurfaceFindingKind {
  if (value === "any" || value === "unknown" || value === "string-index" || value === "number-index") {
    return value;
  }
  throw new Error(`${label} is not a supported finding kind.`);
}
