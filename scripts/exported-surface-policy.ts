import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "./typescript-api.js";

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
  readonly includePaths?: ReadonlyArray<string>;
  readonly ownershipInventories?: ReadonlyArray<ExportedSurfaceOwnershipInventory>;
}

export interface ExportedSurfaceOwnershipInventory {
  /** Directory containing one Genes v2 output manifest and its owned files. */
  readonly outputRoot: string;
  /** Exact configured output filename recorded by the compiler, including its extension. */
  readonly outputIdentity: string;
  /** Exact compiler-owned modules whose public shape is an intentional host/runtime boundary. */
  readonly classifications?: ReadonlyArray<ExportedSurfaceOwnedFileClassification>;
}

export interface ExportedSurfaceOwnedFileClassification {
  readonly file: string;
  readonly disposition: "runtime-boundary" | "fixture-boundary" | "known-gap";
  readonly reason: string;
  /** Required for a known gap so the exclusion cannot become anonymous debt. */
  readonly owner?: string;
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
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly repoRoot: string;
  readonly isIncluded: (sourceFile: ts.SourceFile) => boolean;
  readonly findings: ExportedSurfaceFinding[];
  readonly findingKeys: Set<string>;
  readonly activeTypes: Set<ts.Type>;
  readonly activeTypeOwners: Set<ts.Symbol>;
}

/**
 * Audits the resolved public type graph emitted by genes-ts and classic Genes.
 *
 * Why: lexical searches cannot see `any` inherited from an import, inferred by
 * TypeScript, or hidden inside an exported generic. A successful `tsc` run is
 * also insufficient because `any` deliberately accepts invalid consumers.
 *
 * What: the audit starts at every export in selected generated modules,
 * follows public signatures and locally declared structural members, and
 * reports `any`, `unknown`, and explicit string/number index signatures.
 * Production profiles select modules from compiler ownership manifests so a
 * newly generated public file enrolls automatically. Explicit include paths
 * remain available for small policy-unit fixtures. External library
 * implementations are not expanded, but their public type arguments are
 * inspected so shapes such as `Promise<any>` remain visible.
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
  const includePaths = resolveIncludePaths(repoRoot, program, options);
  const isIncluded = createSourceMatcher(repoRoot, includePaths);
  const findings: ExportedSurfaceFinding[] = [];
  const context: AuditContext = {
    program,
    checker,
    repoRoot,
    isIncluded,
    findings,
    findingKeys: new Set<string>(),
    activeTypes: new Set<ts.Type>(),
    activeTypeOwners: new Set<ts.Symbol>()
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
        if (targetDeclaration.getSourceFile() === root.sourceFile) {
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

const GENES_OUTPUT_MANIFEST_HEADER = "genes-output-manifest-v2";
const GENES_OUTPUT_OWNER_PREFIX = "owner-base64:";

/**
 * Turns compiler ownership into the audit's module inventory.
 *
 * Why: a hand-maintained list proves only the files it remembers. A new
 * generated module can otherwise compile successfully while its inferred
 * public `any` never reaches the semantic gate.
 *
 * What: exactly one selection mode is accepted. Small unit fixtures may name
 * files directly. Production profiles name the exact compiler output identity;
 * every type-bearing file in that v2 manifest is audited unless the caller
 * gives that exact file a documented boundary or owned-gap classification.
 *
 * How: the reader validates the manifest signature, owner, canonical sorted
 * paths, containment, program enrollment, and every classification. Missing or
 * stale evidence fails closed. The compiler remains unaware of this policy;
 * this is an executable release inventory over files it already owns.
 */
function resolveIncludePaths(
  repoRoot: string,
  program: ts.Program,
  options: ExportedSurfaceAuditOptions
): ReadonlyArray<string> {
  const direct = options.includePaths ?? [];
  const inventories = options.ownershipInventories ?? [];
  if ((direct.length === 0) === (inventories.length === 0)) {
    throw new Error(
      "Exported-surface audit requires exactly one non-empty selection: includePaths or ownershipInventories."
    );
  }
  if (direct.length > 0) return direct;

  const programFiles = new Map(
    program.getSourceFiles().map(sourceFile => [path.resolve(sourceFile.fileName), sourceFile] as const)
  );
  const selected = new Set<string>();

  for (const inventory of inventories) {
    const outputRoot = path.resolve(repoRoot, inventory.outputRoot);
    if (!existsSync(outputRoot) || !statSync(outputRoot).isDirectory()) {
      throw new Error(`Exported-surface ownership root is not a directory: ${inventory.outputRoot}`);
    }
    if (inventory.outputIdentity.length === 0 || path.basename(inventory.outputIdentity) !== inventory.outputIdentity) {
      throw new Error(
        `Exported-surface output identity must be one filename including its extension: ${inventory.outputIdentity}`
      );
    }

    const ownedFiles = readOwnedTypeFiles(outputRoot, inventory.outputIdentity);
    const ownedSet = new Set(ownedFiles);
    const classified = new Set<string>();
    for (const classification of inventory.classifications ?? []) {
      if (!isPortableRelativeFile(classification.file)) {
        throw new Error(`Invalid exported-surface classification path: ${classification.file}`);
      }
      if (classification.disposition !== "runtime-boundary"
        && classification.disposition !== "fixture-boundary"
        && classification.disposition !== "known-gap") {
        throw new Error(`Unsupported exported-surface disposition for ${classification.file}.`);
      }
      if (classification.reason.trim().length === 0) {
        throw new Error(`Exported-surface classification needs a reason: ${classification.file}`);
      }
      if (classification.disposition === "known-gap" && (classification.owner?.trim().length ?? 0) === 0) {
        throw new Error(`Known exported-surface gap needs an owning issue: ${classification.file}`);
      }
      if (classified.has(classification.file)) {
        throw new Error(`Duplicate exported-surface classification: ${classification.file}`);
      }
      if (!ownedSet.has(classification.file)) {
        throw new Error(
          `Stale exported-surface classification is not a type-bearing owned file: ${classification.file}`
        );
      }
      classified.add(classification.file);
    }

    for (const relativeFile of ownedFiles) {
      if (classified.has(relativeFile)) continue;
      const absoluteFile = path.resolve(outputRoot, ...relativeFile.split("/"));
      if (!programFiles.has(absoluteFile)) {
        throw new Error(
          `Compiler-owned type module is missing from the TypeScript Program: ${path.relative(repoRoot, absoluteFile)}`
        );
      }
      if (selected.has(absoluteFile)) {
        throw new Error(
          `Compiler-owned type module is enrolled by more than one inventory: ${path.relative(repoRoot, absoluteFile)}`
        );
      }
      selected.add(absoluteFile);
    }
  }

  if (selected.size === 0) {
    throw new Error("Exported-surface ownership inventories selected no type-bearing modules.");
  }
  return [...selected].sort(compareCodeUnits);
}

function readOwnedTypeFiles(outputRoot: string, outputIdentity: string): ReadonlyArray<string> {
  const matchingManifests: string[] = [];
  for (const name of readdirSync(outputRoot).sort(compareCodeUnits)) {
    if (!name.startsWith(".genes-output-") || !name.endsWith(".manifest")) continue;
    const manifestPath = path.join(outputRoot, name);
    if (!statSync(manifestPath).isFile()) continue;
    const lines = readFileSync(manifestPath, "utf8")
      .split("\n")
      .map(line => line.endsWith("\r") ? line.slice(0, -1) : line);
    if (lines[0] !== GENES_OUTPUT_MANIFEST_HEADER) continue;
    const ownerLine = lines[1] ?? "";
    if (!ownerLine.startsWith(GENES_OUTPUT_OWNER_PREFIX)) {
      throw new Error(`Genes v2 output manifest has no owner identity: ${manifestPath}`);
    }
    const encodedOwner = ownerLine.slice(GENES_OUTPUT_OWNER_PREFIX.length);
    const decodedOwner = decodeManifestOwner(encodedOwner, manifestPath);
    if (decodedOwner === outputIdentity) matchingManifests.push(manifestPath);
  }

  if (matchingManifests.length !== 1) {
    throw new Error(
      `Expected one Genes v2 ownership manifest for ${JSON.stringify(outputIdentity)} in ${outputRoot}; found ${matchingManifests.length}.`
    );
  }

  const manifestPath = matchingManifests[0];
  const lines = readFileSync(manifestPath, "utf8")
    .split("\n")
    .map(line => line.endsWith("\r") ? line.slice(0, -1) : line);
  const entries = lines.slice(2);
  if (entries.at(-1) === "") entries.pop();

  const owned: string[] = [];
  let previous: string | null = null;
  const portableKeys = new Set<string>();
  for (const relativeFile of entries) {
    if (!isPortableRelativeFile(relativeFile)) {
      throw new Error(`Invalid Genes ownership path in ${manifestPath}: ${JSON.stringify(relativeFile)}`);
    }
    if (previous !== null && compareCodeUnits(previous, relativeFile) >= 0) {
      throw new Error(`Genes ownership paths are not strictly sorted in ${manifestPath}.`);
    }
    const portableKey = relativeFile.toLowerCase();
    if (portableKeys.has(portableKey)) {
      throw new Error(`Genes ownership paths have a case-insensitive collision in ${manifestPath}.`);
    }
    portableKeys.add(portableKey);
    previous = relativeFile;
    if (!isTypeBearingModule(relativeFile)) continue;

    const absoluteFile = path.resolve(outputRoot, ...relativeFile.split("/"));
    if (!isPathWithin(outputRoot, absoluteFile) || !existsSync(absoluteFile) || !statSync(absoluteFile).isFile()) {
      throw new Error(`Genes ownership manifest names a missing type module: ${absoluteFile}`);
    }
    owned.push(relativeFile);
  }
  return owned;
}

function decodeManifestOwner(encodedOwner: string, manifestPath: string): string {
  let decoded: string;
  try {
    decoded = Buffer.from(encodedOwner, "base64").toString("utf8");
  } catch {
    throw new Error(`Genes output manifest has invalid owner encoding: ${manifestPath}`);
  }
  if (Buffer.from(decoded, "utf8").toString("base64") !== encodedOwner || decoded.length === 0) {
    throw new Error(`Genes output manifest has non-canonical owner encoding: ${manifestPath}`);
  }
  return decoded;
}

function isTypeBearingModule(relativeFile: string): boolean {
  return relativeFile.endsWith(".ts") || relativeFile.endsWith(".tsx");
}

function isPortableRelativeFile(relativeFile: string): boolean {
  if (relativeFile.length === 0 || relativeFile.includes("\\") || relativeFile.includes("\0")) return false;
  if (path.posix.isAbsolute(relativeFile) || path.posix.normalize(relativeFile) !== relativeFile) return false;
  return relativeFile.split("/").every(segment => segment.length > 0 && segment !== "." && segment !== "..");
}

function isPathWithin(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Matches Haxe's deterministic string ordering without host-locale rules. */
function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
  return compareCodeUnits(left.fileName, right.fileName);
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

  // Recursive generic APIs can instantiate a fresh TypeScript `Type` object
  // at each level even though every level comes from the same declaration.
  // Object identity alone therefore does not bound traversal. The first visit
  // owns that declaration's complete member/syntax graph; a recursive revisit
  // checks immediate weak arguments, then stops before unfolding it again.
  const typeOwner = type.aliasSymbol ?? type.symbol;
  if (typeOwner !== undefined && context.activeTypeOwners.has(typeOwner)) {
    visitImmediateWeakArguments(context, type, surfacePath, root);
    return;
  }

  context.activeTypes.add(type);
  if (typeOwner !== undefined) context.activeTypeOwners.add(typeOwner);
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
        const reference = objectType as ts.TypeReference;
        context.checker
          .getTypeArguments(reference)
          .forEach((argument, index) => {
            if (isDefaultLibraryWeakDefault(context, reference, argument, index)) return;
            visitType(context, argument, `${surfacePath}.typeArg[${index}]`, root);
          });
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

    if (!shouldExpandRootStructure(type, root)) return;

    for (const indexInfo of context.checker.getIndexInfosOfType(type)) {
      if (indexInfo.declaration === undefined || indexInfo.declaration.getSourceFile() !== root.sourceFile) continue;
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
      const localDeclarations = declarations.filter(declaration => declaration.getSourceFile() === root.sourceFile);
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
    if (typeOwner !== undefined) context.activeTypeOwners.delete(typeOwner);
    context.activeTypes.delete(type);
  }
}

function visitImmediateWeakArguments(
  context: AuditContext,
  type: ts.Type,
  surfacePath: string,
  root: ExportRoot
): void {
  const argumentsToCheck: ReadonlyArray<ts.Type> = (type.flags & ts.TypeFlags.Object) !== 0
    && ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0
    ? context.checker.getTypeArguments(type as ts.TypeReference)
    : type.aliasTypeArguments ?? [];
  argumentsToCheck.forEach((argument, index) => {
    if ((argument.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
      visitType(context, argument, `${surfacePath}.recursiveArg[${index}]`, root);
    }
  });
}

/**
 * Ignores only implicit weak defaults owned by TypeScript's built-in library.
 *
 * Why: TS6 resolves `IterableIterator<string>` to three arguments whose two
 * omitted iterator protocol slots default to `any`. Treating those resolved
 * defaults as emitted API would make every standard iterator fail the genes
 * policy even though generated syntax supplied only the precise `string`.
 *
 * What/How: suppress an `any`/`unknown` argument only when the corresponding
 * type parameter belongs to a default-library source file and declares the
 * same weak default. An explicit `IterableIterator<string, any>` remains
 * visible through syntax traversal, while `Promise<any>` and imported user
 * declarations remain semantic findings because they do not meet this rule.
 */
function isDefaultLibraryWeakDefault(
  context: AuditContext,
  reference: ts.TypeReference,
  argument: ts.Type,
  index: number
): boolean {
  const weakFlag = argument.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown);
  if (weakFlag === 0) return false;
  const parameter = reference.target.typeParameters?.[index];
  if (parameter === undefined) return false;
  const defaultType = context.checker.getDefaultFromTypeParameter(parameter);
  if (defaultType === undefined
    || (defaultType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== weakFlag) {
    return false;
  }
  return (parameter.symbol?.declarations ?? []).some(declaration =>
    context.program.isSourceFileDefaultLibrary(declaration.getSourceFile())
  );
}

/**
 * Expands one module's own declarations without recursively unfolding every
 * other enrolled generated module.
 *
 * Every compiler-owned module is now audited as an independent export root.
 * Expanding imported structures again from each consumer would multiply the
 * same graph paths and can unroll recursive generic APIs indefinitely. Weak
 * imported values and explicit generic arguments are still inspected before
 * this boundary; the imported declaration's own module audit owns its member
 * graph.
 */
function shouldExpandRootStructure(type: ts.Type, root: ExportRoot): boolean {
  const declarations = [
    ...(type.aliasSymbol?.declarations ?? []),
    ...(type.symbol?.declarations ?? [])
  ];
  return declarations.some(declaration => declaration.getSourceFile() === root.sourceFile);
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
    if (declaration === undefined || declaration.getSourceFile() !== root.sourceFile) return;
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
