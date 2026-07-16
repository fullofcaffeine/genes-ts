import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  inspectEffectiveModuleRequests,
  type EffectiveImportDisposition,
  type EffectiveModuleRequestFile
} from "./semantic/effective-module-requests.js";
import ts from "./typescript-api.js";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertJson(actual: readonly string[], expected: readonly string[], label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(actual)}`
    );
  }
}

const ambientModules = `
declare module "named-unused" { export const unusedNamed: number; }
declare module "default-unused" { const value: number; export default value; }
declare module "namespace-unused" { export const member: number; }
declare module "empty" {}
declare module "inline-only" { export interface InlineOnly { readonly tag: "inline"; } }
declare module "declaration-only" { export interface DeclarationOnly { readonly tag: "type"; } }
declare module "mixed" {
  export const used: number;
  export interface MixedType { readonly tag: "mixed"; }
}
declare module "value-used-as-type" { export class TypeUsedAsType {} }
declare module "bare" {}
`;

const esmSource = `
import { unusedNamed as unusedAlias } from "named-unused";
import unusedDefault from "default-unused";
import * as unusedNamespace from "namespace-unused";
import {} from "empty";
import { type InlineOnly } from "inline-only";
import type { DeclarationOnly } from "declaration-only";
import { used as renamedUsed, type MixedType } from "mixed";
import { TypeUsedAsType } from "value-used-as-type";
import "bare";

type InlineUse = InlineOnly;
type DeclarationUse = DeclarationOnly;
type MixedUse = MixedType;
type ValueTypeUse = TypeUsedAsType;
export const observed: number = renamedUsed;
`;

const commonJsSource = `
import { unusedNamed as unusedAlias } from "named-unused";
import type { DeclarationOnly } from "declaration-only";
import { used as renamedUsed, type MixedType } from "mixed";
import "bare";

type DeclarationUse = DeclarationOnly;
type MixedUse = MixedType;
export const observed: number = renamedUsed;
`;

type Inspection = {
  readonly source: string;
  readonly file: EffectiveModuleRequestFile;
};

function inspectFixture(
  fixtureRoot: string,
  fileName: "main.mts" | "main.cts",
  source: string,
  verbatimModuleSyntax: boolean,
  noEmit = false
): Inspection {
  const caseRoot = path.join(
    fixtureRoot,
    `${path.basename(fileName, path.extname(fileName))}-${verbatimModuleSyntax ? "verbatim" : "elided"}`
      + `${noEmit ? "-no-emit" : ""}`
  );
  fs.mkdirSync(caseRoot, { recursive: true });
  const mainPath = path.join(caseRoot, fileName);
  const ambientPath = path.join(caseRoot, "ambient.d.ts");
  fs.writeFileSync(mainPath, source, "utf8");
  fs.writeFileSync(ambientPath, ambientModules, "utf8");

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    noEmitOnError: true,
    noEmit,
    outDir: path.join(caseRoot, "out"),
    verbatimModuleSyntax,
    esModuleInterop: true
  };
  const program = ts.createProgram({ rootNames: [mainPath, ambientPath], options });
  const sourceFile = program.getSourceFile(mainPath);
  assert(sourceFile !== undefined, `TypeScript did not load ${mainPath}`);
  const inventory = inspectEffectiveModuleRequests(program, [sourceFile]);
  assert(inventory.typescriptVersion === ts.version, "inventory lost the exact TS engine version");
  const file = inventory.files[0];
  assert(file !== undefined, `request inventory omitted ${mainPath}`);
  assert(file.emittedJavaScript !== null, `request inventory did not capture output for ${mainPath}`);
  return { source, file };
}

function dispositionSummary(entries: readonly EffectiveImportDisposition[]): string[] {
  return entries.map(entry => {
    if (entry.disposition !== "runtime-request") {
      return `${entry.specifier}:${entry.disposition}`;
    }
    return `${entry.specifier}:runtime:${entry.requestOrdinal}:${entry.moduleFormat}:${entry.emittedShape}`;
  });
}

function emittedEsmRequests(file: EffectiveModuleRequestFile): string[] {
  assert(file.emittedJavaScript !== null, "ESM output was not captured");
  const output = ts.createSourceFile(
    file.outputFile ?? "output.mjs",
    file.emittedJavaScript,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  return output.statements
    .filter(ts.isImportDeclaration)
    .map(statement => {
      assert(ts.isStringLiteralLike(statement.moduleSpecifier), "emitted ESM import was not literal");
      const clause = statement.importClause;
      let shape: string;
      if (!clause) {
        shape = "bare";
      } else if (!clause.namedBindings) {
        shape = clause.name ? "default" : "empty";
      } else if (ts.isNamespaceImport(clause.namedBindings)) {
        shape = clause.name ? "default-and-namespace" : "namespace";
      } else if (clause.name) {
        shape = clause.namedBindings.elements.length > 0
          ? "default-and-named"
          : "default-and-empty";
      } else {
        shape = clause.namedBindings.elements.length > 0 ? "named" : "empty";
      }
      return `${statement.moduleSpecifier.text}:${shape}`;
    });
}

function emittedRequireSpecifiers(file: EffectiveModuleRequestFile): string[] {
  assert(file.emittedJavaScript !== null, "CommonJS output was not captured");
  const output = ts.createSourceFile(
    file.outputFile ?? "output.cjs",
    file.emittedJavaScript,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "require"
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      specifiers.push(node.arguments[0]!.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(output);
  return specifiers;
}

function runtimeBindingSummary(file: EffectiveModuleRequestFile): string[] {
  return file.runtimeRequests.map((request) =>
    `${request.specifier}:${request.runtimeBindings
      .map((binding) => `${binding.kind}:${binding.localName}`)
      .join(",")}`
  );
}

function assertProvenance(inspection: Inspection): void {
  inspection.file.imports.forEach((entry, index) => {
    assert(entry.sourceOrdinal === index, `${entry.specifier} has an unstable source ordinal`);
    assert(
      inspection.source.slice(entry.sourceStart, entry.sourceEnd) === entry.sourceText,
      `${entry.specifier} lost its original source span`
    );
    assert(entry.sourceText.startsWith("import"), `${entry.specifier} provenance is not an import`);
    assert(entry.sourceLine > 0 && entry.sourceColumn > 0, `${entry.specifier} has an invalid location`);
  });
}

/**
 * Blocks drift between ts2hx's request evidence and configured TypeScript emit.
 *
 * The same ESM source is compiled with `verbatimModuleSyntax` disabled and
 * enabled, proving named/default/namespace/empty/mixed/aliased/type-only/bare
 * cases against the final emitted JavaScript. A `.cts` case proves that the
 * observer distinguishes retained CommonJS requests instead of misreporting
 * source `import` syntax as ESM. No generated Haxe path consumes this inventory
 * yet; the fixture is deliberately an evidence-only prerequisite.
 */
function main(): void {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "genes-esm-request-inventory-"));
  try {
    const elided = inspectFixture(fixtureRoot, "main.mts", esmSource, false);
    assertJson(dispositionSummary(elided.file.imports), [
      "named-unused:elided",
      "default-unused:elided",
      "namespace-unused:elided",
      "empty:elided",
      "inline-only:elided",
      "declaration-only:type-only",
      "mixed:runtime:0:esm:named",
      "value-used-as-type:elided",
      "bare:runtime:1:esm:bare"
    ], "verbatimModuleSyntax=false dispositions drifted");
    assertJson(
      emittedEsmRequests(elided.file),
      elided.file.runtimeRequests.map(request => `${request.specifier}:${request.emittedShape}`),
      "elided ESM request inventory disagrees with emitted JavaScript"
    );
    assertJson(runtimeBindingSummary(elided.file), [
      "mixed:named:renamedUsed",
      "bare:"
    ], "non-verbatim runtime binding inventory drifted");

    const verbatim = inspectFixture(fixtureRoot, "main.mts", esmSource, true);
    assertJson(dispositionSummary(verbatim.file.imports), [
      "named-unused:runtime:0:esm:named",
      "default-unused:runtime:1:esm:default",
      "namespace-unused:runtime:2:esm:namespace",
      "empty:runtime:3:esm:empty",
      "inline-only:runtime:4:esm:empty",
      "declaration-only:type-only",
      "mixed:runtime:5:esm:named",
      "value-used-as-type:runtime:6:esm:named",
      "bare:runtime:7:esm:bare"
    ], "verbatimModuleSyntax=true dispositions drifted");
    assertJson(
      emittedEsmRequests(verbatim.file),
      verbatim.file.runtimeRequests.map(request => `${request.specifier}:${request.emittedShape}`),
      "verbatim ESM request inventory disagrees with emitted JavaScript"
    );
    assertJson(runtimeBindingSummary(verbatim.file), [
      "named-unused:named:unusedAlias",
      "default-unused:default:unusedDefault",
      "namespace-unused:namespace:unusedNamespace",
      "empty:",
      "inline-only:",
      "mixed:named:renamedUsed",
      "value-used-as-type:named:TypeUsedAsType",
      "bare:"
    ], "verbatim runtime binding inventory drifted");
    const mixed = verbatim.file.runtimeRequests.find(request => request.specifier === "mixed");
    assert(mixed?.emittedStatement.includes("used as renamedUsed") === true, "alias spelling was lost");
    assert(
      verbatim.file.emittedJavaScript?.includes("used as renamedUsed") === true,
      "aliased mixed import was not present in final JavaScript"
    );
    const inlineOnly = verbatim.file.runtimeRequests.find(
      request => request.specifier === "inline-only"
    );
    assert(inlineOnly?.emittedShape === "empty", "inline type-only binding did not become import {}");

    const commonJs = inspectFixture(fixtureRoot, "main.cts", commonJsSource, false);
    assertJson(dispositionSummary(commonJs.file.imports), [
      "named-unused:elided",
      "declaration-only:type-only",
      "mixed:runtime:0:commonjs:commonjs",
      "bare:runtime:1:commonjs:commonjs"
    ], "CommonJS dispositions drifted");
    assertJson(
      emittedRequireSpecifiers(commonJs.file),
      commonJs.file.runtimeRequests.map(request => request.specifier),
      "CommonJS request inventory disagrees with emitted JavaScript"
    );

    const configuredNoEmit = inspectFixture(fixtureRoot, "main.mts", esmSource, false, true);
    assertJson(
      dispositionSummary(configuredNoEmit.file.imports),
      dispositionSummary(elided.file.imports),
      "noEmit shadow evidence changed effective request dispositions"
    );
    assertJson(
      emittedEsmRequests(configuredNoEmit.file),
      emittedEsmRequests(elided.file),
      "noEmit shadow evidence changed configured JavaScript emit"
    );

    assertProvenance(elided);
    assertProvenance(verbatim);
    assertProvenance(commonJs);
    assertProvenance(configuredNoEmit);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }

  process.stdout.write(
    `Effective module requests OK (TypeScript ${ts.version}; verbatim off/on + ESM/CommonJS + noEmit shadow)\n`
  );
}

main();
