import fs from "fs";
import path from "path";
import ts from "typescript";
import { toHaxeModuleName, toHaxePackagePath } from "../util.js";

export type EmitHaxeOptions = {
  projectDir: string;
  rootDir: string;
  program: ts.Program;
  checker: ts.TypeChecker;
  sourceFiles: ts.SourceFile[];
  outDir: string;
  basePackage: string;
};

type ImportSpec = {
  moduleSpecifier: string;
  defaultImport: string | null;
  namespaceImport: string | null;
  named: Array<{ name: string; alias: string | null }>;
};

type ExportFromSpec =
  | { kind: "named"; moduleSpecifier: string; elements: Array<{ exported: string; source: string }> }
  | { kind: "all"; moduleSpecifier: string };

function isRelativeModuleSpecifier(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

function stripTsExtension(spec: string): string {
  return spec.replace(/\.(d\.)?(tsx?|jsx?)$/i, "");
}

function moduleTargetFromImport(opts: {
  projectDir: string;
  rootDir: string;
  fromFile: string;
  basePackage: string;
}, spec: string): {
  packagePath: string;
  moduleName: string;
} {
  const fromDir = path.dirname(opts.fromFile);
  const resolved = path.resolve(fromDir, stripTsExtension(spec));

  const relativeToRoot = path.relative(opts.rootDir, resolved);
  const relNoExt = relativeToRoot.replace(/\.(tsx?|jsx?)$/i, "");
  const segments = relNoExt.split(path.sep).filter((p) => p.length > 0);

  const fileBase = segments.length > 0 ? segments[segments.length - 1] : "Module";
  const dirSegments = segments.slice(0, -1);

  return {
    packagePath: toHaxePackagePath([opts.basePackage, ...dirSegments]),
    moduleName: toHaxeModuleName(fileBase)
  };
}

function isLikelyTypeName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

type EmitContext = {
  identifierRewrites: Map<string, string>;
};

type ExternModule = {
  moduleSpecifier: string;
  className: string;
  needsDefault: boolean;
  namedValues: Set<string>;
};

function isValidHaxeIdentifier(name: string): boolean {
  return /^[_a-zA-Z][_a-zA-Z0-9]*$/.test(name);
}

// Minimal reserved-word protection for extern field names.
// Keep this list short and add to it when real-world fixtures demand it.
const HAXE_RESERVED = new Set([
  "default",
  "function",
  "var",
  "final",
  "class",
  "enum",
  "typedef",
  "package",
  "import",
  "public",
  "private",
  "static",
  "new",
  "null",
  "true",
  "false"
]);

function externFieldForExportName(exportedName: string): { hxName: string; nativeName: string | null } {
  if (exportedName === "default") return { hxName: "__default", nativeName: "default" };
  if (isValidHaxeIdentifier(exportedName) && !HAXE_RESERVED.has(exportedName)) return { hxName: exportedName, nativeName: null };

  const cleaned = exportedName
    .replace(/^[^_a-zA-Z]+/, "_")
    .replace(/[^_a-zA-Z0-9]/g, "_");
  const hxName = cleaned.length > 0 && !HAXE_RESERVED.has(cleaned) ? cleaned : `_${cleaned}`;
  return { hxName, nativeName: exportedName };
}

function externModuleNameFromSpecifier(spec: string): string {
  return toHaxeModuleName(spec.replace(/^@/, "").replace(/[^a-z0-9]+/gi, "_"));
}

function collectNamespaceMemberAccesses(sf: ts.SourceFile, namespaceImports: Array<{ alias: string; moduleSpecifier: string }>): Map<string, Set<string>> {
  const aliasToSpec = new Map<string, string>();
  for (const imp of namespaceImports) aliasToSpec.set(imp.alias, imp.moduleSpecifier);

  const perSpec = new Map<string, Set<string>>();
  function add(spec: string, name: string) {
    const existing = perSpec.get(spec) ?? new Set<string>();
    existing.add(name);
    perSpec.set(spec, existing);
  }

  function visit(node: ts.Node) {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const spec = aliasToSpec.get(node.expression.text);
      if (spec) add(spec, node.name.text);
    }

    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.argumentExpression &&
      ts.isStringLiteral(node.argumentExpression)
    ) {
      const spec = aliasToSpec.get(node.expression.text);
      if (spec) add(spec, node.argumentExpression.text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return perSpec;
}

function buildExternModules(opts: EmitHaxeOptions): Map<string, ExternModule> {
  const externs = new Map<string, ExternModule>();

  for (const sf of opts.sourceFiles) {
    const imports = collectImports(sf);

    for (const imp of imports) {
      if (isRelativeModuleSpecifier(imp.moduleSpecifier)) continue;

      const existing = externs.get(imp.moduleSpecifier);
      const ex: ExternModule =
        existing ??
        ({
          moduleSpecifier: imp.moduleSpecifier,
          className: externModuleNameFromSpecifier(imp.moduleSpecifier),
          needsDefault: false,
          namedValues: new Set<string>()
        } as ExternModule);

      if (imp.defaultImport) ex.needsDefault = true;
      for (const el of imp.named) {
        const exportedName = el.alias ?? el.name;
        ex.namedValues.add(exportedName);
      }

      externs.set(imp.moduleSpecifier, ex);
    }

    const namespaceImports = imports
      .filter((i) => !isRelativeModuleSpecifier(i.moduleSpecifier) && i.namespaceImport)
      .map((i) => ({ alias: i.namespaceImport as string, moduleSpecifier: i.moduleSpecifier }));
    const accessed = collectNamespaceMemberAccesses(sf, namespaceImports);
    for (const [spec, names] of accessed.entries()) {
      const ex = externs.get(spec);
      if (!ex) continue;
      for (const n of names) ex.namedValues.add(n);
    }
  }

  return externs;
}

function emitExternModuleFile(opts: EmitHaxeOptions, ex: ExternModule): { filePath: string; content: string } {
  const externPackage = toHaxePackagePath([opts.basePackage, "extern"]);
  const basePackageDirs = opts.basePackage.split(".").filter((p) => p.length > 0);
  const outAbsFile = path.resolve(opts.outDir, path.join(...basePackageDirs, "extern", `${ex.className}.hx`));

  const lines: string[] = [];
  lines.push(`package ${externPackage};`);
  lines.push("");
  lines.push(`@:jsRequire(${JSON.stringify(ex.moduleSpecifier)})`);
  lines.push(`extern class ${ex.className} {`);
  if (ex.needsDefault) lines.push(`  @:native("default") static var __default: Dynamic;`);
  for (const exportName of Array.from(ex.namedValues).sort((a, b) => a.localeCompare(b))) {
    const f = externFieldForExportName(exportName);
    if (f.hxName === "__default" && ex.needsDefault) continue;
    if (f.nativeName) lines.push(`  @:native(${JSON.stringify(f.nativeName)}) static var ${f.hxName}: Dynamic;`);
    else lines.push(`  static var ${f.hxName}: Dynamic;`);
  }
  lines.push(`}`);
  lines.push("");

  return { filePath: outAbsFile, content: lines.join("\n") };
}

function emitType(typeNode: ts.TypeNode | undefined): string {
  if (!typeNode) return "Dynamic";

  switch (typeNode.kind) {
    case ts.SyntaxKind.NumberKeyword:
      return "Float";
    case ts.SyntaxKind.StringKeyword:
      return "String";
    case ts.SyntaxKind.BooleanKeyword:
      return "Bool";
    case ts.SyntaxKind.VoidKeyword:
      return "Void";
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      return "Dynamic";
    case ts.SyntaxKind.TypeReference: {
      const ref = typeNode as ts.TypeReferenceNode;
      const baseName = ts.isIdentifier(ref.typeName)
        ? ref.typeName.text
        : ts.isQualifiedName(ref.typeName)
          ? ref.typeName.right.text
          : null;
      if (!baseName) return "Dynamic";

      const typeArgs = ref.typeArguments ?? [];
      if (typeArgs.length === 0) return baseName;

      const args = typeArgs.map((a) => emitType(a));
      return `${baseName}<${args.join(", ")}>`;
    }
    case ts.SyntaxKind.ArrayType: {
      const arr = typeNode as ts.ArrayTypeNode;
      return `Array<${emitType(arr.elementType)}>`;
    }
    case ts.SyntaxKind.ParenthesizedType: {
      const p = typeNode as ts.ParenthesizedTypeNode;
      return emitType(p.type);
    }
    case ts.SyntaxKind.TypeLiteral: {
      const lit = typeNode as ts.TypeLiteralNode;
      if (lit.members.length === 0) return "{}";

      const parts: string[] = [];
      for (const member of lit.members) {
        if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
          const isOptional = !!member.questionToken;
          const fieldType = emitType(member.type);
          parts.push(isOptional ? `@:optional var ${member.name.text}: ${fieldType};` : `var ${member.name.text}: ${fieldType};`);
          continue;
        }
        if (ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name)) {
          const isOptional = !!member.questionToken;
          const params = member.parameters.map((p) => {
            const id = ts.isIdentifier(p.name) ? p.name.text : "arg";
            const isParamOptional = !!p.questionToken;
            const t = emitType(p.type);
            return `${isParamOptional ? "?" : ""}${id}: ${t}`;
          });
          const ret = emitType(member.type);
          parts.push(`${isOptional ? "@:optional " : ""}function ${member.name.text}(${params.join(", ")}): ${ret};`);
          continue;
        }
        return "Dynamic";
      }

      return `{ ${parts.join(" ")} }`;
    }
    default:
      return "Dynamic";
  }
}

function emitExpression(ctx: EmitContext, expr: ts.Expression): string | null {
  switch (expr.kind) {
    case ts.SyntaxKind.NumericLiteral:
      return (expr as ts.NumericLiteral).text;
    case ts.SyntaxKind.StringLiteral:
      return JSON.stringify((expr as ts.StringLiteral).text);
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return JSON.stringify((expr as ts.NoSubstitutionTemplateLiteral).text);
    case ts.SyntaxKind.TrueKeyword:
      return "true";
    case ts.SyntaxKind.FalseKeyword:
      return "false";
    case ts.SyntaxKind.NullKeyword:
      return "null";
    case ts.SyntaxKind.Identifier: {
      const name = (expr as ts.Identifier).text;
      return ctx.identifierRewrites.get(name) ?? name;
    }
    case ts.SyntaxKind.ThisKeyword:
      return "this";
    case ts.SyntaxKind.ParenthesizedExpression: {
      const inner = emitExpression(ctx, (expr as ts.ParenthesizedExpression).expression);
      return inner ? `(${inner})` : null;
    }
    case ts.SyntaxKind.TemplateExpression: {
      const t = expr as ts.TemplateExpression;
      const parts: string[] = [];

      // Haxe does not allow `Float + String` in strict typing, but does allow `String + Float`.
      // Ensure we always start concatenation with a String.
      if (t.head.text.length === 0) parts.push('""');
      else parts.push(JSON.stringify(t.head.text));

      for (const span of t.templateSpans) {
        const value = emitExpression(ctx, span.expression);
        if (!value) return null;
        parts.push(value);

        const tail = span.literal.text;
        if (tail.length > 0) parts.push(JSON.stringify(tail));
      }

      return `(${parts.join(" + ")})`;
    }
    case ts.SyntaxKind.NonNullExpression: {
      const inner = emitExpression(ctx, (expr as ts.NonNullExpression).expression);
      return inner ? `(${inner})` : null;
    }
    case ts.SyntaxKind.ArrowFunction: {
      const fn = expr as ts.ArrowFunction;
      const params = fn.parameters.map((p) => {
        const id = ts.isIdentifier(p.name) ? p.name.text : "arg";
        const t = emitType(p.type);
        return p.type ? `${id}: ${t}` : id;
      });

      if (ts.isBlock(fn.body)) {
        const body = emitStatements(ctx, fn.body.statements, "  ");
        if (body == null) return null;
        return `function(${params.join(", ")}) {\n${body}\n}`;
      }

      const bodyExpr = emitExpression(ctx, fn.body);
      if (!bodyExpr) return null;
      return `function(${params.join(", ")}) return ${bodyExpr}`;
    }
    case ts.SyntaxKind.ObjectLiteralExpression: {
      const obj = expr as ts.ObjectLiteralExpression;
      const literalFields: string[] = [];
      const parts: string[] = [];
      let sawSpread = false;

      function flushLiteral() {
        if (literalFields.length === 0) return;
        parts.push(`{ ${literalFields.join(", ")} }`);
        literalFields.length = 0;
      }

      for (const prop of obj.properties) {
        if (ts.isSpreadAssignment(prop)) {
          sawSpread = true;
          flushLiteral();
          const spreadValue = emitExpression(ctx, prop.expression);
          if (!spreadValue) return null;
          parts.push(spreadValue);
          continue;
        }

        if (ts.isPropertyAssignment(prop)) {
          const name =
            ts.isIdentifier(prop.name)
              ? prop.name.text
              : ts.isStringLiteral(prop.name)
                ? prop.name.text
                : null;
          if (!name) return null;
          const value = emitExpression(ctx, prop.initializer);
          if (!value) return null;
          literalFields.push(`${name}: ${value}`);
          continue;
        }

        if (ts.isShorthandPropertyAssignment(prop)) {
          const name = prop.name.text;
          const value = ctx.identifierRewrites.get(name) ?? name;
          literalFields.push(`${name}: ${value}`);
          continue;
        }

        if (ts.isMethodDeclaration(prop) && prop.name) {
          const name =
            ts.isIdentifier(prop.name)
              ? prop.name.text
              : ts.isStringLiteral(prop.name)
                ? prop.name.text
                : null;
          if (!name) return null;
          if (!prop.body) return null;

          const params = prop.parameters.map((p) => {
            const id = ts.isIdentifier(p.name) ? p.name.text : "arg";
            const isOptional = !!p.questionToken;
            const t = emitType(p.type);
            return `${isOptional ? "?" : ""}${id}: ${t}`;
          });

          let fn: string | null = null;
          if (prop.body.statements.length === 1 && ts.isReturnStatement(prop.body.statements[0])) {
            const ret = prop.body.statements[0] as ts.ReturnStatement;
            if (!ret.expression) return null;
            const retExpr = emitExpression(ctx, ret.expression);
            if (!retExpr) return null;
            fn = `function(${params.join(", ")}) return ${retExpr}`;
          } else {
            const body = emitStatements(ctx, prop.body.statements, "  ");
            if (body == null) return null;
            fn = `function(${params.join(", ")}) {\n${body}\n}`;
          }

          literalFields.push(`${name}: ${fn}`);
          continue;
        }

        return null;
      }

      if (!sawSpread) return `{ ${literalFields.join(", ")} }`;

      flushLiteral();
      if (parts.length === 0) return "{}";
      // `js.lib.Object.assign` returns the target type, so use a `Dynamic` target to avoid
      // over-constraining the inferred anonymous-structure type (which would break field access).
      return `js.lib.Object.assign(cast {}, ${parts.join(", ")})`;
    }
    case ts.SyntaxKind.ArrayLiteralExpression: {
      const arr = expr as ts.ArrayLiteralExpression;
      const items = arr.elements.map((e) => emitExpression(ctx, e));
      if (items.some((a) => a == null)) return null;
      return `[${items.join(", ")}]`;
    }
    case ts.SyntaxKind.ElementAccessExpression: {
      const el = expr as ts.ElementAccessExpression;
      const left = emitExpression(ctx, el.expression);
      const index = el.argumentExpression ? emitExpression(ctx, el.argumentExpression) : null;
      if (!left || !index) return null;
      return `${left}[${index}]`;
    }
    case ts.SyntaxKind.PropertyAccessExpression: {
      const access = expr as ts.PropertyAccessExpression;
      const left = emitExpression(ctx, access.expression);
      if (!left) return null;
      const hasQuestionDot = "questionDotToken" in access && (access as unknown as { questionDotToken?: unknown }).questionDotToken != null;
      return hasQuestionDot ? `${left}?.${access.name.text}` : `${left}.${access.name.text}`;
    }
    case ts.SyntaxKind.NewExpression: {
      const ne = expr as ts.NewExpression;
      let callee = emitExpression(ctx, ne.expression);
      if (!callee) return null;
      if (ts.isIdentifier(ne.expression) && ne.expression.text === "Error") {
        // TS `Error` maps to `js.lib.Error` on the JS target.
        callee = "js.lib.Error";
      }
      const args = (ne.arguments ?? []).map((a) => emitExpression(ctx, a));
      if (args.some((a) => a == null)) return null;
      return `new ${callee}(${args.join(", ")})`;
    }
    case ts.SyntaxKind.BinaryExpression: {
      const bin = expr as ts.BinaryExpression;
      const left = emitExpression(ctx, bin.left);
      const right = emitExpression(ctx, bin.right);
      if (!left || !right) return null;
      const op = bin.operatorToken.kind;
      if (op === ts.SyntaxKind.EqualsToken) {
        return `${left} = ${right}`;
      }
      if (op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsEqualsToken) {
        return `(${left} == ${right})`;
      }
      if (op === ts.SyntaxKind.ExclamationEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
        return `(${left} != ${right})`;
      }
      if (
        op === ts.SyntaxKind.PlusToken ||
        op === ts.SyntaxKind.MinusToken ||
        op === ts.SyntaxKind.AsteriskToken ||
        op === ts.SyntaxKind.SlashToken
      ) {
        const opText = ts.tokenToString(op) ?? "+";
        return `(${left} ${opText} ${right})`;
      }
      if (
        op === ts.SyntaxKind.LessThanToken ||
        op === ts.SyntaxKind.LessThanEqualsToken ||
        op === ts.SyntaxKind.GreaterThanToken ||
        op === ts.SyntaxKind.GreaterThanEqualsToken
      ) {
        const opText = ts.tokenToString(op) ?? "<";
        return `(${left} ${opText} ${right})`;
      }
      if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
        const opText = ts.tokenToString(op) ?? "&&";
        return `(${left} ${opText} ${right})`;
      }
      if (op === ts.SyntaxKind.QuestionQuestionToken) {
        return `(${left} ?? ${right})`;
      }
      return null;
    }
    case ts.SyntaxKind.PrefixUnaryExpression: {
      const un = expr as ts.PrefixUnaryExpression;
      if (un.operator !== ts.SyntaxKind.ExclamationToken) return null;
      const inner = emitExpression(ctx, un.operand);
      if (!inner) return null;
      return `!(${inner})`;
    }
    case ts.SyntaxKind.ConditionalExpression: {
      const cond = expr as ts.ConditionalExpression;
      const test = emitExpression(ctx, cond.condition);
      const whenTrue = emitExpression(ctx, cond.whenTrue);
      const whenFalse = emitExpression(ctx, cond.whenFalse);
      if (!test || !whenTrue || !whenFalse) return null;
      return `(${test} ? ${whenTrue} : ${whenFalse})`;
    }
    case ts.SyntaxKind.CallExpression: {
      const call = expr as ts.CallExpression;

      // Best-effort builtin mappings for Haxe-for-JS (v0).
      if (ts.isPropertyAccessExpression(call.expression)) {
        const access = call.expression;
        const left = emitExpression(ctx, access.expression);
        if (!left) return null;

        // `JSON.stringify(x)` -> `haxe.Json.stringify(x)`
        if (access.name.text === "stringify" && ts.isIdentifier(access.expression) && access.expression.text === "JSON") {
          if (call.arguments.length !== 1) return null;
          const arg0 = emitExpression(ctx, call.arguments[0]);
          if (!arg0) return null;
          return `haxe.Json.stringify(${arg0})`;
        }

        // `str.trim()` -> `StringTools.trim(str)`
        if (access.name.text === "trim" && call.arguments.length === 0) {
          return `StringTools.trim(${left})`;
        }

        // `arr.slice()` -> `arr.slice(0)` (Haxe requires at least the `pos` arg).
        if (access.name.text === "slice" && call.arguments.length === 0) {
          return `${left}.slice(0)`;
        }

        // `console.log(x)` -> `trace(x)`
        if (access.name.text === "log" && ts.isIdentifier(access.expression) && access.expression.text === "console") {
          if (call.arguments.length !== 1) return null;
          const arg0 = emitExpression(ctx, call.arguments[0]);
          if (!arg0) return null;
          return `trace(${arg0})`;
        }
      }

      const callee = emitExpression(ctx, call.expression);
      if (!callee) return null;
      const args = call.arguments.map((a) => emitExpression(ctx, a));
      if (args.some((a) => a == null)) return null;
      return `${callee}(${args.join(", ")})`;
    }
    default:
      return null;
  }
}

function emitStatements(ctx: EmitContext, statements: readonly ts.Statement[], indent: string): string | null {
  const out: string[] = [];

  for (const stmt of statements) {
    const emitted = emitStatement(ctx, stmt, indent);
    if (emitted == null) return null;
    if (emitted.length > 0) out.push(emitted);
  }

  return out.join("\n");
}

function emitStatement(ctx: EmitContext, stmt: ts.Statement, indent: string): string | null {
  if (ts.isBlock(stmt)) {
    const inner = emitStatements(ctx, stmt.statements, indent + "  ");
    if (inner == null) return null;
    if (inner.length === 0) return `${indent}{}`;
    return `${indent}{\n${inner}\n${indent}}`;
  }

  if (ts.isReturnStatement(stmt)) {
    if (!stmt.expression) return `${indent}return;`;
    const expr = emitExpression(ctx, stmt.expression);
    if (!expr) return null;
    return `${indent}return ${expr};`;
  }

  if (ts.isExpressionStatement(stmt)) {
    const expr = emitExpression(ctx, stmt.expression);
    if (!expr) return null;
    return `${indent}${expr};`;
  }

  if (ts.isVariableStatement(stmt)) {
    const decls: string[] = [];
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) return null;
      const name = decl.name.text;
      const init = decl.initializer ? emitExpression(ctx, decl.initializer) : null;
      if (!init) return null;
      const typeSuffix = decl.type ? `: ${emitType(decl.type)}` : "";
      decls.push(`${indent}var ${name}${typeSuffix} = ${init};`);
    }
    return decls.join("\n");
  }

  if (ts.isIfStatement(stmt)) {
    const cond = emitExpression(ctx, stmt.expression);
    if (!cond) return null;
    const thenPart = emitStatement(ctx, stmt.thenStatement, ts.isBlock(stmt.thenStatement) ? indent : indent + "  ");
    if (thenPart == null) return null;
    const thenBlock = ts.isBlock(stmt.thenStatement) ? thenPart : `${indent}{\n${thenPart}\n${indent}}`;

    if (!stmt.elseStatement) return `${indent}if (${cond}) ${thenBlock}`;

    const elsePart = emitStatement(ctx, stmt.elseStatement, ts.isBlock(stmt.elseStatement) ? indent : indent + "  ");
    if (elsePart == null) return null;
    const elseBlock = ts.isBlock(stmt.elseStatement) ? elsePart : `${indent}{\n${elsePart}\n${indent}}`;
    return `${indent}if (${cond}) ${thenBlock} else ${elseBlock}`;
  }

  if (ts.isThrowStatement(stmt)) {
    const expr = stmt.expression ? emitExpression(ctx, stmt.expression) : null;
    if (!expr) return null;
    return `${indent}throw ${expr};`;
  }

  if (ts.isTryStatement(stmt)) {
    const tryBlock = emitStatement(ctx, stmt.tryBlock, indent);
    if (tryBlock == null) return null;
    if (!stmt.catchClause) return null;
    const catchName =
      stmt.catchClause.variableDeclaration && ts.isIdentifier(stmt.catchClause.variableDeclaration.name)
        ? stmt.catchClause.variableDeclaration.name.text
        : "e";
    const catchBody = emitStatement(ctx, stmt.catchClause.block, indent);
    if (catchBody == null) return null;

    const tryBlockNoIndent = tryBlock.startsWith(indent) ? tryBlock.slice(indent.length) : tryBlock;
    const catchBodyNoIndent = catchBody.startsWith(indent) ? catchBody.slice(indent.length) : catchBody;
    return `${indent}try ${tryBlockNoIndent} catch (${catchName}: Dynamic) ${catchBodyNoIndent}`;
  }

  if (ts.isForStatement(stmt)) {
    // Best-effort translation to a `while` loop.
    if (!stmt.initializer || !stmt.condition || !stmt.incrementor) return null;

    const initLines: string[] = [];
    if (ts.isVariableDeclarationList(stmt.initializer)) {
      for (const decl of stmt.initializer.declarations) {
        if (!ts.isIdentifier(decl.name)) return null;
        const init = decl.initializer ? emitExpression(ctx, decl.initializer) : null;
        if (!init) return null;
        initLines.push(`${indent}  var ${decl.name.text} = ${init};`);
      }
    } else {
      const init = emitExpression(ctx, stmt.initializer);
      if (!init) return null;
      initLines.push(`${indent}  ${init};`);
    }

    const cond = emitExpression(ctx, stmt.condition);
    const inc = emitExpression(ctx, stmt.incrementor);
    if (!cond || !inc) return null;

    const bodyInner = ts.isBlock(stmt.statement)
      ? emitStatements(ctx, stmt.statement.statements, indent + "    ")
      : emitStatement(ctx, stmt.statement, indent + "    ");
    if (bodyInner == null) return null;

    const whileBody =
      bodyInner.length === 0
        ? `${indent}  while (${cond}) {\n${indent}    ${inc};\n${indent}  }`
        : `${indent}  while (${cond}) {\n${bodyInner}\n${indent}    ${inc};\n${indent}  }`;

    return `${indent}{\n${initLines.join("\n")}\n${whileBody}\n${indent}}`;
  }

  if (ts.isForOfStatement(stmt)) {
    if (!ts.isVariableDeclarationList(stmt.initializer)) return null;
    const decl = stmt.initializer.declarations[0];
    if (!decl || !ts.isIdentifier(decl.name)) return null;
    const name = decl.name.text;

    const iter = emitExpression(ctx, stmt.expression);
    if (!iter) return null;

    const bodyPart = emitStatement(ctx, stmt.statement, ts.isBlock(stmt.statement) ? indent : indent + "  ");
    if (bodyPart == null) return null;
    const bodyBlock = ts.isBlock(stmt.statement) ? bodyPart : `${indent}{\n${bodyPart}\n${indent}}`;
    return `${indent}for (${name} in ${iter}) ${bodyBlock}`;
  }

  return null;
}

function emitFunctionLike(opts: {
  name: string;
  parameters: readonly ts.ParameterDeclaration[];
  returnType: ts.TypeNode | undefined;
  body: ts.Block | undefined;
  modifierPrefix: string;
  omitReturnType?: boolean;
  ctx: EmitContext;
}): string {
  const params = opts.parameters.map((p) => {
    const id = ts.isIdentifier(p.name) ? p.name.text : "arg";
    const isOptional = !!p.questionToken;
    const type = emitType(p.type);
    return `${isOptional ? "?" : ""}${id}: ${type}`;
  });

  const returnType = emitType(opts.returnType);
  const returnTypeSuffix = opts.omitReturnType ? "" : `: ${returnType}`;

  let body = `  throw "ts2hx: unsupported";`;
  if (opts.body) {
    const emitted = emitStatements(opts.ctx, opts.body.statements, "  ");
    if (emitted) body = emitted;
  }

  return `${opts.modifierPrefix}function ${opts.name}(${params.join(", ")})${returnTypeSuffix} {\n${body}\n}`;
}

function emitFunction(ctx: EmitContext, fn: ts.FunctionDeclaration): string {
  return emitFunctionLike({
    name: fn.name?.text ?? "anon",
    parameters: fn.parameters,
    returnType: fn.type,
    body: fn.body,
    modifierPrefix: "",
    ctx
  });
}

function emitTypeAlias(decl: ts.TypeAliasDeclaration): string {
  const name = decl.name.text;
  if (ts.isUnionTypeNode(decl.type)) {
    const items = decl.type.types;
    const stringLits: string[] = [];
    for (const item of items) {
      if (!ts.isLiteralTypeNode(item) || !ts.isStringLiteral(item.literal)) {
        stringLits.length = 0;
        break;
      }
      stringLits.push(item.literal.text);
    }
    if (stringLits.length > 0) {
      const lines: string[] = [];
      lines.push(`enum abstract ${name}(String) from String to String {`);
      for (const lit of stringLits) {
        const member = toHaxeModuleName(lit);
        lines.push(`  var ${member} = ${JSON.stringify(lit)};`);
      }
      lines.push(`}`);
      return lines.join("\n");
    }
  }

  const type = emitType(decl.type);
  return `typedef ${name} = ${type};`;
}

function emitInterface(decl: ts.InterfaceDeclaration): string {
  const name = decl.name.text;

  const lines: string[] = [];
  lines.push(`typedef ${name} = {`);

  for (const member of decl.members) {
    if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
      const isOptional = !!member.questionToken;
      const fieldType = emitType(member.type);
      if (isOptional) lines.push(`  @:optional var ${member.name.text}: ${fieldType};`);
      else lines.push(`  var ${member.name.text}: ${fieldType};`);
      continue;
    }
    if (ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name)) {
      const isOptional = !!member.questionToken;
      const params = member.parameters.map((p) => {
        const id = ts.isIdentifier(p.name) ? p.name.text : "arg";
        const isParamOptional = !!p.questionToken;
        const t = emitType(p.type);
        return `${isParamOptional ? "?" : ""}${id}: ${t}`;
      });
      const ret = emitType(member.type);
      const prefix = isOptional ? "  @:optional " : "  ";
      lines.push(`${prefix}function ${member.name.text}(${params.join(", ")}): ${ret};`);
      continue;
    }
  }

  lines.push(`}`);
  return lines.join("\n");
}

function emitEnum(decl: ts.EnumDeclaration): string {
  const name = decl.name.text;

  let underlying: "Float" | "String" = "Float";
  for (const member of decl.members) {
    if (member.initializer && ts.isStringLiteral(member.initializer)) underlying = "String";
  }

  const lines: string[] = [];
  lines.push(`enum abstract ${name}(${underlying}) from ${underlying} to ${underlying} {`);

  let nextNumeric = 0;
  for (const member of decl.members) {
    const memberName = ts.isIdentifier(member.name)
      ? member.name.text
      : ts.isStringLiteral(member.name)
        ? member.name.text
        : "Member";

    let valueText: string | null = null;
    if (!member.initializer) {
      valueText = underlying === "String" ? JSON.stringify(memberName) : String(nextNumeric);
      nextNumeric++;
    } else if (ts.isNumericLiteral(member.initializer)) {
      valueText = member.initializer.text;
      nextNumeric = parseInt(member.initializer.text, 10) + 1;
    } else if (ts.isStringLiteral(member.initializer)) {
      valueText = JSON.stringify(member.initializer.text);
    }

    if (!valueText) continue;
    lines.push(`  var ${memberName} = ${valueText};`);
  }

  lines.push(`}`);
  return lines.join("\n");
}

function emitClass(ctx: EmitContext, decl: ts.ClassDeclaration): string {
  const name = decl.name?.text ?? "AnonymousClass";
  const lines: string[] = [];

  lines.push(`class ${name} {`);

  for (const member of decl.members) {
    if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const isStatic = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
      const isPrivate = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword) ?? false;
      const visibility = isPrivate ? "private" : "public";
      const type = emitType(member.type);
      lines.push(`  ${visibility} ${isStatic ? "static " : ""}var ${member.name.text}: ${type};`);
      continue;
    }

    if (ts.isConstructorDeclaration(member)) {
      const emitted = emitFunctionLike({
        name: "new",
        parameters: member.parameters,
        returnType: undefined,
        body: member.body,
        modifierPrefix: "  public ",
        omitReturnType: true,
        ctx
      });
      lines.push(...emitted.split("\n").map((l, i) => (i === 0 ? l : `  ${l}`)));
      continue;
    }

    if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
      const isStatic = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
      const isPrivate = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword) ?? false;
      const visibility = isPrivate ? "private" : "public";
      const emitted = emitFunctionLike({
        name: member.name.text,
        parameters: member.parameters,
        returnType: member.type,
        body: member.body,
        modifierPrefix: `  ${visibility} ${isStatic ? "static " : ""}`,
        ctx
      });
      lines.push(...emitted.split("\n").map((l, i) => (i === 0 ? l : `  ${l}`)));
      continue;
    }
  }

  lines.push(`}`);
  return lines.join("\n");
}

function collectImports(sf: ts.SourceFile): ImportSpec[] {
  const imports: ImportSpec[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const moduleSpecifier = stmt.moduleSpecifier.text;
    const clause = stmt.importClause;
    if (!clause) continue;

    const defaultImport = clause.name ? clause.name.text : null;
    let namespaceImport: string | null = null;
    let named: Array<{ name: string; alias: string | null }> = [];

    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        namespaceImport = clause.namedBindings.name.text;
      } else if (ts.isNamedImports(clause.namedBindings)) {
        named = clause.namedBindings.elements.map((el) => ({
          name: el.name.text,
          alias: el.propertyName ? el.propertyName.text : null
        }));
      }
    }

    imports.push({ moduleSpecifier, defaultImport, namespaceImport, named });
  }

  return imports;
}

function collectExportFroms(sf: ts.SourceFile): ExportFromSpec[] {
  const exports: ExportFromSpec[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt)) continue;
    if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const moduleSpecifier = stmt.moduleSpecifier.text;

    if (!stmt.exportClause) {
      exports.push({ kind: "all", moduleSpecifier });
      continue;
    }

    if (!ts.isNamedExports(stmt.exportClause)) continue;
    const elements = stmt.exportClause.elements.map((el) => ({
      exported: el.name.text,
      source: el.propertyName ? el.propertyName.text : el.name.text
    }));
    exports.push({ kind: "named", moduleSpecifier, elements });
  }

  return exports;
}

type ExportKind = "value" | "type" | "both";

function collectExportKinds(sf: ts.SourceFile): Map<string, ExportKind> {
  const kinds = new Map<string, ExportKind>();

  function set(name: string, kind: ExportKind) {
    const prev = kinds.get(name);
    if (!prev) {
      kinds.set(name, kind);
      return;
    }
    if (prev === kind) return;
    kinds.set(name, "both");
  }

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      if (isExported) set(stmt.name.text, "value");
      continue;
    }
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      if (isExported) set(stmt.name.text, "both");
      continue;
    }
    if (ts.isEnumDeclaration(stmt)) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      if (isExported) set(stmt.name.text, "both");
      continue;
    }
    if (ts.isInterfaceDeclaration(stmt)) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      if (isExported) set(stmt.name.text, "type");
      continue;
    }
    if (ts.isTypeAliasDeclaration(stmt)) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      if (isExported) set(stmt.name.text, "type");
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      if (!isExported) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) set(decl.name.text, "value");
      }
      continue;
    }
  }

  return kinds;
}

function resolveRelativeSourceFile(program: ts.Program, fromFile: string, moduleSpecifier: string): ts.SourceFile | null {
  if (!isRelativeModuleSpecifier(moduleSpecifier)) return null;
  const fromDir = path.dirname(fromFile);
  const resolvedBase = path.resolve(fromDir, stripTsExtension(moduleSpecifier));
  const candidates = [
    resolvedBase,
    `${resolvedBase}.ts`,
    `${resolvedBase}.tsx`,
    `${resolvedBase}.js`,
    `${resolvedBase}.jsx`
  ];
  for (const candidate of candidates) {
    const sf = program.getSourceFile(candidate);
    if (sf) return sf;
  }
  return null;
}

function emitHaxeSourceFile(opts: EmitHaxeOptions, sf: ts.SourceFile): { filePath: string; content: string } | null {
  const absFile = sf.fileName;
  if (absFile.endsWith(".d.ts")) return null;
  if (!(absFile.endsWith(".ts") || absFile.endsWith(".tsx") || absFile.endsWith(".js") || absFile.endsWith(".jsx"))) {
    return null;
  }

  const relToRoot = path.relative(opts.rootDir, absFile);
  const relDir = path.dirname(relToRoot);
  const fileBase = path.basename(relToRoot).replace(/\.(d\.)?(tsx?|jsx?)$/i, "");
  const moduleName = toHaxeModuleName(fileBase);

  const basePackageDirs = opts.basePackage.split(".").filter((p) => p.length > 0);
  const outRelFile = path.join(...basePackageDirs, relDir, `${moduleName}.hx`);
  const outAbsFile = path.resolve(opts.outDir, outRelFile);

  const packageSegments = relDir === "." ? [] : relDir.split(path.sep).filter((p) => p.length > 0);
  const packagePath = toHaxePackagePath([opts.basePackage, ...packageSegments]);

  const out: string[] = [];
  out.push(`package ${packagePath};`);
  out.push("");

  const ctx: EmitContext = { identifierRewrites: new Map() };

  const imports = collectImports(sf);
  const importLines: string[] = [];
  for (const imp of imports) {
    if (isRelativeModuleSpecifier(imp.moduleSpecifier)) {
      const target = moduleTargetFromImport(
        { projectDir: opts.projectDir, rootDir: opts.rootDir, fromFile: absFile, basePackage: opts.basePackage },
        imp.moduleSpecifier
      );

      const moduleBase = target.packagePath.length > 0 ? `${target.packagePath}.${target.moduleName}` : target.moduleName;

      if (imp.defaultImport) {
        importLines.push(`import ${moduleBase}.__default as ${imp.defaultImport};`);
      }
      if (imp.namespaceImport) {
        ctx.identifierRewrites.set(imp.namespaceImport, moduleBase);
      }

      for (const { name, alias } of imp.named) {
        const effectiveName = alias ?? name;
        if (isLikelyTypeName(effectiveName)) {
          const typeImport =
            effectiveName === target.moduleName
              ? target.packagePath.length > 0
                ? `${target.packagePath}.${effectiveName}`
                : effectiveName
              : `${moduleBase}.${effectiveName}`;
          importLines.push(alias ? `import ${typeImport} as ${name};` : `import ${typeImport};`);
        } else {
          importLines.push(alias ? `import ${moduleBase}.${effectiveName} as ${name};` : `import ${moduleBase}.${effectiveName};`);
        }
      }
      continue;
    }

    // Non-relative module specifiers: rewrite identifiers to generated extern modules.
    const externPackage = toHaxePackagePath([opts.basePackage, "extern"]);
    const externModuleName = externModuleNameFromSpecifier(imp.moduleSpecifier);
    const moduleBase = `${externPackage}.${externModuleName}`;

    if (imp.namespaceImport) ctx.identifierRewrites.set(imp.namespaceImport, moduleBase);
    if (imp.defaultImport) ctx.identifierRewrites.set(imp.defaultImport, `${moduleBase}.__default`);
    for (const { name, alias } of imp.named) {
      const exportedName = alias ?? name;
      const field = exportedName === "default" ? "__default" : exportedName;
      ctx.identifierRewrites.set(name, `${moduleBase}.${field}`);
    }
  }

  if (importLines.length > 0) {
    out.push(...importLines);
    out.push("");
  }

  const exportFroms = collectExportFroms(sf);
  const reexported = new Set<string>();
  for (const exp of exportFroms) {
    if (!isRelativeModuleSpecifier(exp.moduleSpecifier)) continue;

    const target = moduleTargetFromImport(
      { projectDir: opts.projectDir, rootDir: opts.rootDir, fromFile: absFile, basePackage: opts.basePackage },
      exp.moduleSpecifier
    );
    const moduleBase = target.packagePath.length > 0 ? `${target.packagePath}.${target.moduleName}` : target.moduleName;
    const srcFile = resolveRelativeSourceFile(opts.program, absFile, exp.moduleSpecifier);
    const kinds = srcFile ? collectExportKinds(srcFile) : null;

    if (exp.kind === "named") {
      for (const { exported, source } of exp.elements) {
        const hxSource = source === "default" ? "__default" : source;
        const ref = `${moduleBase}.${hxSource}`;
        const kind =
          hxSource === "__default"
            ? "value"
            : (kinds?.get(source) ?? (isLikelyTypeName(exported) ? "type" : "value"));
        if (kind === "type") out.push(`typedef ${exported} = ${ref};`);
        else out.push(`final ${exported} = ${ref};`);
        reexported.add(exported);
      }
      out.push("");
      continue;
    }

    // export * from "./x"
    if (!srcFile) return null;

    for (const [name, kind] of collectExportKinds(srcFile).entries()) {
      if (reexported.has(name)) continue;
      const ref = `${moduleBase}.${name}`;
      if (kind === "type") out.push(`typedef ${name} = ${ref};`);
      else out.push(`final ${name} = ${ref};`);
      reexported.add(name);
    }
    out.push("");
  }

  for (const stmt of sf.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      const expr = emitExpression(ctx, stmt.expression);
      if (!expr) return null;
      out.push(`final __default = ${expr};`);
      out.push("");
      continue;
    }

    if (ts.isVariableStatement(stmt)) {
      const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      if (!isExported) continue;

      const declKeyword = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0 ? "final" : "var";
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) return null;
        if (!decl.initializer) return null;
        const init = emitExpression(ctx, decl.initializer);
        if (!init) return null;
        const typeSuffix = decl.type ? `: ${emitType(decl.type)}` : "";
        out.push(`${declKeyword} ${decl.name.text}${typeSuffix} = ${init};`);
      }
      out.push("");
      continue;
    }

    if (ts.isFunctionDeclaration(stmt)) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      if (!isExported) continue;
      out.push(emitFunction(ctx, stmt));
      const isDefault = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
      if (isDefault) {
        if (!stmt.name) return null;
        out.push(`final __default = ${stmt.name.text};`);
      }
      out.push("");
      continue;
    }

    if (ts.isTypeAliasDeclaration(stmt)) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      if (!isExported) continue;
      out.push(emitTypeAlias(stmt));
      out.push("");
      continue;
    }

    if (ts.isInterfaceDeclaration(stmt)) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      if (!isExported) continue;
      out.push(emitInterface(stmt));
      out.push("");
      continue;
    }

    if (ts.isEnumDeclaration(stmt)) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      if (!isExported) continue;
      out.push(emitEnum(stmt));
      out.push("");
      continue;
    }

    if (ts.isClassDeclaration(stmt)) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      if (!isExported) continue;
      out.push(emitClass(ctx, stmt));
      const isDefault = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
      if (isDefault) {
        if (!stmt.name) return null;
        out.push(`final __default = ${stmt.name.text};`);
      }
      out.push("");
      continue;
    }
  }

  return { filePath: outAbsFile, content: out.join("\n").trimEnd() + "\n" };
}

export function emitProjectToHaxe(opts: EmitHaxeOptions): { writtenFiles: string[] } {
  const writtenFiles: string[] = [];
  fs.mkdirSync(opts.outDir, { recursive: true });

  const externs = buildExternModules(opts);
  for (const ex of Array.from(externs.values()).sort((a, b) => a.moduleSpecifier.localeCompare(b.moduleSpecifier))) {
    const emitted = emitExternModuleFile(opts, ex);
    fs.mkdirSync(path.dirname(emitted.filePath), { recursive: true });
    fs.writeFileSync(emitted.filePath, emitted.content, "utf8");
    writtenFiles.push(emitted.filePath);
  }

  for (const sf of opts.sourceFiles.slice().sort((a, b) => a.fileName.localeCompare(b.fileName))) {
    const emitted = emitHaxeSourceFile(opts, sf);
    if (!emitted) continue;
    fs.mkdirSync(path.dirname(emitted.filePath), { recursive: true });
    fs.writeFileSync(emitted.filePath, emitted.content, "utf8");
    writtenFiles.push(emitted.filePath);
  }

  return { writtenFiles };
}
