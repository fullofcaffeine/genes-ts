import { deepStrictEqual } from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "./project.js";
import {
  planPackageExternBinding,
  type PackageExternSource
} from "./semantic/package-extern-plan.js";
import ts from "./typescript-api.js";

/**
 * Checker evidence and a shadow plan for a future typed package boundary.
 *
 * Why: the runtime request carrier already handles package order, but current
 * generated package extern fields are `Dynamic`. Before choosing an automatic
 * declaration subset, we need stable evidence for the exact symbols and types
 * TypeScript exposes for default, aliased named, and namespace imports.
 *
 * What: this test reads local declarations through the pinned
 * Program/TypeChecker adapter. It records alias and type facts, then passes
 * them through a closed primitive-only plan. A separate shape fixture proves
 * every accepted type and deterministic rejection reason.
 *
 * How: every reported field excludes absolute paths and object identity. The
 * comparisons therefore become deterministic shadow contracts. The test does
 * not generate Haxe, connect the plan to an emitter, or promote support.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(__dirname, "..");
const fixtureRoot = path.join(toolRoot, "fixtures", "non-relative-imports");
const loaded = loadProject(path.join(fixtureRoot, "tsconfig.json"));

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

if (!loaded.ok)
  throw new Error(`package extern fixture failed to load: ${loaded.diagnostics.length} diagnostic(s)`);
const sourceFile = loaded.sourceFiles.find((source) => source.fileName.endsWith("/src/Main.ts"));
assert(sourceFile !== undefined, "package extern fixture lost src/Main.ts");
const checker = loaded.checker;
const printer = ts.createPrinter({ removeComments: true });

type ValueFact = Readonly<{
  exportName: string;
  targetName: string;
  declarationKinds: readonly string[];
  declarationFile: string;
  typeKind: string;
  typeText: string;
  stability: "function" | "const" | "mutable-or-unknown";
}>;

type ImportFact =
  | Readonly<{ kind: "binding"; localName: string; value: ValueFact }>
  | Readonly<{
      kind: "namespace";
      localName: string;
      valueExports: readonly string[];
      typeOnlyExports: readonly string[];
      declarationFile: string;
    }>;

function declarationFor(symbol: ts.Symbol): ts.Declaration {
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  assert(declaration !== undefined, `symbol ${symbol.getName()} has no declaration`);
  return declaration;
}

function stableDeclarationFile(declaration: ts.Declaration): string {
  return path.relative(fixtureRoot, declaration.getSourceFile().fileName)
    .split(path.sep)
    .join("/");
}

function sourceFactFrom(root: string, node: ts.Node): PackageExternSource {
  const source = node.getSourceFile();
  const start = node.getStart(source);
  const location = source.getLineAndCharacterOfPosition(start);
  return {
    file: path.relative(root, source.fileName).split(path.sep).join("/"),
    start,
    end: node.getEnd(),
    line: location.line + 1,
    column: location.character + 1
  };
}

function sourceFact(node: ts.Node): PackageExternSource {
  return sourceFactFrom(fixtureRoot, node);
}

function stabilityOf(symbol: ts.Symbol): ValueFact["stability"] {
  const declaration = symbol.valueDeclaration;
  if (declaration && ts.isFunctionDeclaration(declaration)) return "function";
  if (declaration && ts.isVariableDeclaration(declaration)) {
    const flags = ts.getCombinedNodeFlags(declaration.parent);
    if ((flags & ts.NodeFlags.Const) !== 0) return "const";
  }
  return "mutable-or-unknown";
}

function valueFact(exportName: string, symbol: ts.Symbol): ValueFact {
  const declaration = declarationFor(symbol);
  const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  const typeNode = checker.typeToTypeNode(
    type,
    declaration,
    ts.NodeBuilderFlags.NoTruncation
  );
  assert(typeNode !== undefined, `checker could not materialize ${exportName}`);
  const declarationKinds = (symbol.declarations ?? [declaration])
    .map((item) => ts.SyntaxKind[item.kind] ?? `SyntaxKind(${item.kind})`)
    .sort((left, right) => left.localeCompare(right));
  return {
    exportName,
    targetName: symbol.getName(),
    declarationKinds,
    declarationFile: stableDeclarationFile(declaration),
    typeKind: ts.SyntaxKind[typeNode.kind] ?? `SyntaxKind(${typeNode.kind})`,
    typeText: printer.printNode(
      ts.EmitHint.Unspecified,
      typeNode,
      declaration.getSourceFile()
    ),
    stability: stabilityOf(symbol)
  };
}

function aliasedSymbol(local: ts.Identifier): ts.Symbol {
  const alias = checker.getSymbolAtLocation(local);
  assert(alias !== undefined, `checker lost local import ${local.text}`);
  assert((alias.flags & ts.SymbolFlags.Alias) !== 0, `${local.text} is not an alias symbol`);
  return checker.getAliasedSymbol(alias);
}

const importFacts: ImportFact[] = [];
let namespaceLocal: string | null = null;
let packageSourceNode: ts.StringLiteral | null = null;
const localImportNodes = new Map<string, ts.Identifier>();
const packageExports = new Map<string, ts.Symbol>();
for (const statement of sourceFile.statements) {
  if (!ts.isImportDeclaration(statement)
    || !ts.isStringLiteral(statement.moduleSpecifier)
    || statement.moduleSpecifier.text !== "fakepkg"
    || !statement.importClause) continue;

  packageSourceNode ??= statement.moduleSpecifier;

  const moduleSymbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
  assert(moduleSymbol !== undefined, "checker lost fakepkg's module symbol");
  const moduleDeclaration = declarationFor(moduleSymbol);
  const exports = checker.getExportsOfModule(moduleSymbol);
  for (const item of exports) packageExports.set(item.getName(), item);
  const valueExports = exports
    .filter((item) => {
      const target = (item.flags & ts.SymbolFlags.Alias) !== 0
        ? checker.getAliasedSymbol(item)
        : item;
      return (target.flags & ts.SymbolFlags.Value) !== 0;
    })
    .map((item) => item.getName())
    .sort((left, right) => left.localeCompare(right));
  const typeOnlyExports = exports
    .filter((item) => {
      const target = (item.flags & ts.SymbolFlags.Alias) !== 0
        ? checker.getAliasedSymbol(item)
        : item;
      return (target.flags & ts.SymbolFlags.Value) === 0;
    })
    .map((item) => item.getName())
    .sort((left, right) => left.localeCompare(right));

  if (statement.importClause.name) {
    localImportNodes.set(statement.importClause.name.text, statement.importClause.name);
    importFacts.push({
      kind: "binding",
      localName: statement.importClause.name.text,
      value: valueFact("default", aliasedSymbol(statement.importClause.name))
    });
  }

  const named = statement.importClause.namedBindings;
  if (named && ts.isNamedImports(named)) {
    for (const element of named.elements) {
      localImportNodes.set(element.name.text, element.name);
      importFacts.push({
        kind: "binding",
        localName: element.name.text,
        value: valueFact(
          element.propertyName?.text ?? element.name.text,
          aliasedSymbol(element.name)
        )
      });
    }
  } else if (named && ts.isNamespaceImport(named)) {
    localImportNodes.set(named.name.text, named.name);
    const target = aliasedSymbol(named.name);
    assert(
      target.getName() === moduleSymbol.getName()
        && (target.flags & ts.SymbolFlags.ValueModule) !== 0
        && stableDeclarationFile(declarationFor(target))
          === stableDeclarationFile(moduleDeclaration),
      "namespace alias did not resolve to equivalent stable package-module facts"
    );
    namespaceLocal = named.name.text;
    importFacts.push({
      kind: "namespace",
      localName: named.name.text,
      valueExports,
      typeOnlyExports,
      declarationFile: stableDeclarationFile(moduleDeclaration)
    });
  }
}

const namespaceMembers: ValueFact[] = [];
const namespaceMemberNodes = new Map<string, ts.Identifier>();
function visit(node: ts.Node): void {
  if (namespaceLocal !== null
    && ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && ts.isIdentifier(node.name)
    && node.expression.text === namespaceLocal) {
    const symbol = checker.getSymbolAtLocation(node.name);
    assert(symbol !== undefined, `checker lost namespace member ${node.name.text}`);
    if (!namespaceMemberNodes.has(node.name.text)) {
      namespaceMemberNodes.set(node.name.text, node.name);
    }
    namespaceMembers.push(valueFact(node.name.text, symbol));
  }
  ts.forEachChild(node, visit);
}
visit(sourceFile);

function packageExport(name: string): ts.Symbol {
  const symbol = packageExports.get(name);
  assert(symbol !== undefined, `checker lost package export ${name}`);
  return (symbol.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

const actual = {
  imports: importFacts,
  namespaceMembers: namespaceMembers.sort((left, right) =>
    left.exportName.localeCompare(right.exportName)
  ),
  deferredBoundaryShapes: [
    valueFact("mutableValue", packageExport("mutableValue")),
    valueFact("overloaded", packageExport("overloaded")),
    valueFact("parseResult", packageExport("parseResult"))
  ]
};

const declarationFile = "node_modules/fakepkg/index.d.ts";
const expected = {
  imports: [
    {
      kind: "binding",
      localName: "greet",
      value: {
        exportName: "default",
        targetName: "greet",
        declarationKinds: ["FunctionDeclaration"],
        declarationFile,
        typeKind: "FunctionType",
        typeText: "(name: string) => string",
        stability: "function"
      }
    },
    {
      kind: "binding",
      localName: "sum",
      value: {
        exportName: "add",
        targetName: "add",
        declarationKinds: ["FunctionDeclaration"],
        declarationFile,
        typeKind: "FunctionType",
        typeText: "(a: number, b: number) => number",
        stability: "function"
      }
    },
    {
      kind: "namespace",
      localName: "Pkg",
      valueExports: [
        "add",
        "default",
        "mutableValue",
        "overloaded",
        "parseResult",
        "PI"
      ],
      typeOnlyExports: ["Result"],
      declarationFile
    }
  ],
  namespaceMembers: [
    {
      exportName: "add",
      targetName: "add",
      declarationKinds: ["FunctionDeclaration"],
      declarationFile,
      typeKind: "FunctionType",
      typeText: "(a: number, b: number) => number",
      stability: "function"
    },
    {
      exportName: "PI",
      targetName: "PI",
      declarationKinds: ["VariableDeclaration"],
      declarationFile,
      typeKind: "NumberKeyword",
      typeText: "number",
      stability: "const"
    }
  ],
  deferredBoundaryShapes: [
    {
      exportName: "mutableValue",
      targetName: "mutableValue",
      declarationKinds: ["VariableDeclaration"],
      declarationFile,
      typeKind: "NumberKeyword",
      typeText: "number",
      stability: "mutable-or-unknown"
    },
    {
      exportName: "overloaded",
      targetName: "overloaded",
      declarationKinds: ["FunctionDeclaration", "FunctionDeclaration"],
      declarationFile,
      typeKind: "TypeLiteral",
      typeText: "{ (value: string): string; (value: number): string; }",
      stability: "function"
    },
    {
      exportName: "parseResult",
      targetName: "parseResult",
      declarationKinds: ["FunctionDeclaration"],
      declarationFile,
      typeKind: "FunctionType",
      typeText: "(input: string) => Result",
      stability: "function"
    }
  ]
};

assert(
  JSON.stringify(actual) === JSON.stringify(expected),
  `package extern facts drifted:\n${JSON.stringify(actual, null, 2)}`
);

function requiredNode(
  nodes: ReadonlyMap<string, ts.Identifier>,
  name: string
): ts.Identifier {
  const node = nodes.get(name);
  assert(node !== undefined, `package extern fixture lost ${name}`);
  return node;
}

function checkedSymbol(node: ts.Node): ts.Symbol {
  const symbol = checker.getSymbolAtLocation(node);
  assert(symbol !== undefined, `checker lost ${node.getText(sourceFile)}`);
  return symbol;
}

assert(packageSourceNode !== null, "package extern fixture lost its fakepkg specifier");
const greetNode = requiredNode(localImportNodes, "greet");
const sumNode = requiredNode(localImportNodes, "sum");
const namespaceNode = requiredNode(localImportNodes, "Pkg");
const namespaceAddNode = requiredNode(namespaceMemberNodes, "add");
const namespacePiNode = requiredNode(namespaceMemberNodes, "PI");
const packageSource = sourceFact(packageSourceNode);

function shadowPlan(
  localReference: string,
  runtimeExportName: string,
  symbol: ts.Symbol | undefined,
  sourceNode: ts.Node
) {
  return planPackageExternBinding({
    checker,
    projectDir: fixtureRoot,
    moduleSpecifier: "fakepkg",
    runtimeExportName,
    localReference,
    symbol,
    source: sourceFact(sourceNode)
  });
}

const shadowPlans = [
  shadowPlan("greet", "default", checkedSymbol(greetNode), greetNode),
  shadowPlan("sum", "add", checkedSymbol(sumNode), sumNode),
  shadowPlan("Pkg.add", "add", checkedSymbol(namespaceAddNode), namespaceAddNode),
  shadowPlan("Pkg.PI", "PI", checkedSymbol(namespacePiNode), namespacePiNode),
  shadowPlan("Pkg", "*", checkedSymbol(namespaceNode), namespaceNode),
  shadowPlan("mutableValue", "mutableValue", packageExport("mutableValue"), packageSourceNode),
  shadowPlan("overloaded", "overloaded", packageExport("overloaded"), packageSourceNode),
  shadowPlan("parseResult", "parseResult", packageExport("parseResult"), packageSourceNode),
  shadowPlan("Result", "Result", packageExport("Result"), packageSourceNode),
  shadowPlan("missing", "missing", undefined, packageSourceNode)
];

const expectedShadowPlans = [
  {
    disposition: "supported",
    moduleSpecifier: "fakepkg",
    runtimeExportName: "default",
    localReference: "greet",
    declarationName: "greet",
    declarationFile,
    source: sourceFact(greetNode),
    member: {
      kind: "function",
      parameters: [{ name: "arg0", type: "String" }],
      returnType: "String"
    }
  },
  {
    disposition: "supported",
    moduleSpecifier: "fakepkg",
    runtimeExportName: "add",
    localReference: "sum",
    declarationName: "add",
    declarationFile,
    source: sourceFact(sumNode),
    member: {
      kind: "function",
      parameters: [
        { name: "arg0", type: "Float" },
        { name: "arg1", type: "Float" }
      ],
      returnType: "Float"
    }
  },
  {
    disposition: "supported",
    moduleSpecifier: "fakepkg",
    runtimeExportName: "add",
    localReference: "Pkg.add",
    declarationName: "add",
    declarationFile,
    source: sourceFact(namespaceAddNode),
    member: {
      kind: "function",
      parameters: [
        { name: "arg0", type: "Float" },
        { name: "arg1", type: "Float" }
      ],
      returnType: "Float"
    }
  },
  {
    disposition: "supported",
    moduleSpecifier: "fakepkg",
    runtimeExportName: "PI",
    localReference: "Pkg.PI",
    declarationName: "PI",
    declarationFile,
    source: sourceFact(namespacePiNode),
    member: { kind: "readonly-value", valueType: "Float" }
  },
  {
    disposition: "unsupported",
    moduleSpecifier: "fakepkg",
    runtimeExportName: "*",
    localReference: "Pkg",
    source: sourceFact(namespaceNode),
    reason: "unsupported-declaration"
  },
  {
    disposition: "unsupported",
    moduleSpecifier: "fakepkg",
    runtimeExportName: "mutableValue",
    localReference: "mutableValue",
    source: packageSource,
    reason: "mutable-export"
  },
  {
    disposition: "unsupported",
    moduleSpecifier: "fakepkg",
    runtimeExportName: "overloaded",
    localReference: "overloaded",
    source: packageSource,
    reason: "overloaded-function"
  },
  {
    disposition: "unsupported",
    moduleSpecifier: "fakepkg",
    runtimeExportName: "parseResult",
    localReference: "parseResult",
    source: packageSource,
    reason: "unsupported-return-type"
  },
  {
    disposition: "unsupported",
    moduleSpecifier: "fakepkg",
    runtimeExportName: "Result",
    localReference: "Result",
    source: packageSource,
    reason: "type-only-symbol"
  },
  {
    disposition: "unsupported",
    moduleSpecifier: "fakepkg",
    runtimeExportName: "missing",
    localReference: "missing",
    source: packageSource,
    reason: "missing-symbol"
  }
];

deepStrictEqual(shadowPlans, expectedShadowPlans);

/**
 * Exercises every first-boundary type and rejection against a real Program.
 *
 * The main fake package keeps the import-order snapshot readable. This second
 * declaration-only fixture isolates less common shapes so adding a planner
 * branch without executable evidence fails this focused owner immediately.
 */
const boundaryRoot = path.join(toolRoot, "fixtures", "package-extern-plan");
const boundaryLoaded = loadProject(path.join(boundaryRoot, "tsconfig.json"));
if (!boundaryLoaded.ok) {
  throw new Error(
    `package extern boundary fixture failed to load: ${boundaryLoaded.diagnostics.length} diagnostic(s)`
  );
}
const boundarySource = boundaryLoaded.sourceFiles.find((source) =>
  source.fileName.endsWith("/src/Main.ts")
);
assert(boundarySource !== undefined, "package extern boundary fixture lost src/Main.ts");
const boundaryChecker = boundaryLoaded.checker;
const boundaryImports = new Map<string, ts.Identifier>();
let localImplementationNode: ts.Identifier | null = null;

for (const statement of boundarySource.statements) {
  if (
    ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === "planpkg"
    && statement.importClause?.namedBindings
    && ts.isNamedImports(statement.importClause.namedBindings)
  ) {
    for (const element of statement.importClause.namedBindings.elements) {
      boundaryImports.set(element.name.text, element.name);
    }
  } else if (
    ts.isFunctionDeclaration(statement)
    && statement.name?.text === "localImplementation"
  ) {
    localImplementationNode = statement.name;
  }
}

function boundaryImport(name: string): ts.Identifier {
  const node = boundaryImports.get(name);
  assert(node !== undefined, `package extern boundary fixture lost ${name}`);
  return node;
}

function boundaryPlan(name: string) {
  const node = boundaryImport(name);
  return planPackageExternBinding({
    checker: boundaryChecker,
    projectDir: boundaryRoot,
    moduleSpecifier: "planpkg",
    runtimeExportName: name,
    localReference: name,
    symbol: boundaryChecker.getSymbolAtLocation(node),
    source: sourceFactFrom(boundaryRoot, node)
  });
}

function compactPlan(plan: ReturnType<typeof planPackageExternBinding>) {
  if (plan.disposition === "unsupported") {
    return {
      localReference: plan.localReference,
      disposition: plan.disposition,
      reason: plan.reason
    };
  }
  return {
    localReference: plan.localReference,
    disposition: plan.disposition,
    declarationName: plan.declarationName,
    declarationFile: plan.declarationFile,
    member: plan.member
  };
}

assert(localImplementationNode !== null, "package extern boundary fixture lost local implementation");
const implementationPlan = planPackageExternBinding({
  checker: boundaryChecker,
  projectDir: boundaryRoot,
  moduleSpecifier: "planpkg",
  runtimeExportName: "localImplementation",
  localReference: "localImplementation",
  symbol: boundaryChecker.getSymbolAtLocation(localImplementationNode),
  source: sourceFactFrom(boundaryRoot, localImplementationNode)
});

const boundaryPlans = [
  "booleanResult",
  "notify",
  "text",
  "enabled",
  "optional",
  "rest",
  "generic",
  "contextual",
  "acceptShape",
  "maybe",
  "merged",
  "Service",
  "literal",
  "record",
  "callback",
  "mutable",
  "Shape"
].map((name) => compactPlan(boundaryPlan(name)));
boundaryPlans.push(compactPlan(implementationPlan));

deepStrictEqual(boundaryPlans, [
  {
    localReference: "booleanResult",
    disposition: "supported",
    declarationName: "booleanResult",
    declarationFile: "node_modules/planpkg/index.d.ts",
    member: { kind: "function", parameters: [], returnType: "Bool" }
  },
  {
    localReference: "notify",
    disposition: "supported",
    declarationName: "notify",
    declarationFile: "node_modules/planpkg/index.d.ts",
    member: {
      kind: "function",
      parameters: [{ name: "arg0", type: "String" }],
      returnType: "Void"
    }
  },
  {
    localReference: "text",
    disposition: "supported",
    declarationName: "text",
    declarationFile: "node_modules/planpkg/index.d.ts",
    member: { kind: "readonly-value", valueType: "String" }
  },
  {
    localReference: "enabled",
    disposition: "supported",
    declarationName: "enabled",
    declarationFile: "node_modules/planpkg/index.d.ts",
    member: { kind: "readonly-value", valueType: "Bool" }
  },
  { localReference: "optional", disposition: "unsupported", reason: "optional-parameter" },
  { localReference: "rest", disposition: "unsupported", reason: "rest-parameter" },
  { localReference: "generic", disposition: "unsupported", reason: "generic-function" },
  {
    localReference: "contextual",
    disposition: "unsupported",
    reason: "explicit-this-parameter"
  },
  {
    localReference: "acceptShape",
    disposition: "unsupported",
    reason: "unsupported-parameter-type"
  },
  {
    localReference: "maybe",
    disposition: "unsupported",
    reason: "unsupported-return-type"
  },
  { localReference: "merged", disposition: "unsupported", reason: "merged-declaration" },
  { localReference: "Service", disposition: "unsupported", reason: "unsupported-declaration" },
  { localReference: "literal", disposition: "unsupported", reason: "unsupported-const-type" },
  { localReference: "record", disposition: "unsupported", reason: "unsupported-const-type" },
  { localReference: "callback", disposition: "unsupported", reason: "unsupported-const-type" },
  { localReference: "mutable", disposition: "unsupported", reason: "mutable-export" },
  { localReference: "Shape", disposition: "unsupported", reason: "type-only-symbol" },
  {
    localReference: "localImplementation",
    disposition: "unsupported",
    reason: "implementation-source"
  }
]);
process.stdout.write(
  "package-extern-facts:ok "
    + "(checker facts + primitive shadow plan + fail-closed boundaries; no Haxe emitted)\n"
);
