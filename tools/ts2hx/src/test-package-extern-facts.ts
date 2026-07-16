import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "./project.js";
import ts from "./typescript-api.js";

/**
 * Shadow evidence for a future strongly typed package-extern plan.
 *
 * Why: the runtime request carrier already handles package order, but current
 * generated package extern fields are `Dynamic`. Before choosing an automatic
 * declaration subset, we need stable evidence for the exact symbols and types
 * TypeScript exposes for default, aliased named, and namespace imports.
 *
 * What: this test reads the existing local `fakepkg` declaration through the
 * pinned Program/TypeChecker adapter. It records alias targets, declaration
 * kinds, checker-produced type nodes, const/function stability, and statically
 * accessed namespace members. It does not generate Haxe or promote support.
 *
 * How: every reported field excludes absolute paths and object identity. The
 * exact JSON comparison therefore becomes a deterministic shadow contract that
 * a later immutable package plan may consume after architecture approval.
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
const packageExports = new Map<string, ts.Symbol>();
for (const statement of sourceFile.statements) {
  if (!ts.isImportDeclaration(statement)
    || !ts.isStringLiteral(statement.moduleSpecifier)
    || statement.moduleSpecifier.text !== "fakepkg"
    || !statement.importClause) continue;

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
    importFacts.push({
      kind: "binding",
      localName: statement.importClause.name.text,
      value: valueFact("default", aliasedSymbol(statement.importClause.name))
    });
  }

  const named = statement.importClause.namedBindings;
  if (named && ts.isNamedImports(named)) {
    for (const element of named.elements) {
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
function visit(node: ts.Node): void {
  if (namespaceLocal !== null
    && ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === namespaceLocal) {
    const symbol = checker.getSymbolAtLocation(node.name);
    assert(symbol !== undefined, `checker lost namespace member ${node.name.text}`);
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
process.stdout.write(
  "package-extern-facts:ok "
    + "(default/named/namespace facts plus mutable/overload/transitive boundaries; no Haxe emitted)\n"
);
