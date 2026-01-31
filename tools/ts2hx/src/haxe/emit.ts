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
  kind: "named";
  moduleSpecifier: string;
  named: Array<{ name: string; alias: string | null }>;
};

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
    default:
      return "Dynamic";
  }
}

function emitExpression(expr: ts.Expression): string | null {
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
    case ts.SyntaxKind.Identifier:
      return (expr as ts.Identifier).text;
    case ts.SyntaxKind.ThisKeyword:
      return "this";
    case ts.SyntaxKind.ParenthesizedExpression: {
      const inner = emitExpression((expr as ts.ParenthesizedExpression).expression);
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
        const value = emitExpression(span.expression);
        if (!value) return null;
        parts.push(value);

        const tail = span.literal.text;
        if (tail.length > 0) parts.push(JSON.stringify(tail));
      }

      return `(${parts.join(" + ")})`;
    }
    case ts.SyntaxKind.NonNullExpression: {
      const inner = emitExpression((expr as ts.NonNullExpression).expression);
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
        const body = emitStatements(fn.body.statements, "  ");
        if (body == null) return null;
        return `function(${params.join(", ")}) {\n${body}\n}`;
      }

      const bodyExpr = emitExpression(fn.body);
      if (!bodyExpr) return null;
      return `function(${params.join(", ")}) return ${bodyExpr}`;
    }
    case ts.SyntaxKind.ObjectLiteralExpression: {
      const obj = expr as ts.ObjectLiteralExpression;
      const fields: string[] = [];
      for (const prop of obj.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const name =
            ts.isIdentifier(prop.name)
              ? prop.name.text
              : ts.isStringLiteral(prop.name)
                ? prop.name.text
                : null;
          if (!name) return null;
          const value = emitExpression(prop.initializer);
          if (!value) return null;
          fields.push(`${name}: ${value}`);
          continue;
        }
        if (ts.isShorthandPropertyAssignment(prop)) {
          fields.push(`${prop.name.text}: ${prop.name.text}`);
          continue;
        }
        return null;
      }
      return `{ ${fields.join(", ")} }`;
    }
    case ts.SyntaxKind.ArrayLiteralExpression: {
      const arr = expr as ts.ArrayLiteralExpression;
      const items = arr.elements.map(emitExpression);
      if (items.some((a) => a == null)) return null;
      return `[${items.join(", ")}]`;
    }
    case ts.SyntaxKind.ElementAccessExpression: {
      const el = expr as ts.ElementAccessExpression;
      const left = emitExpression(el.expression);
      const index = el.argumentExpression ? emitExpression(el.argumentExpression) : null;
      if (!left || !index) return null;
      return `${left}[${index}]`;
    }
    case ts.SyntaxKind.PropertyAccessExpression: {
      const access = expr as ts.PropertyAccessExpression;
      const left = emitExpression(access.expression);
      if (!left) return null;
      const hasQuestionDot = "questionDotToken" in access && (access as unknown as { questionDotToken?: unknown }).questionDotToken != null;
      return hasQuestionDot ? `${left}?.${access.name.text}` : `${left}.${access.name.text}`;
    }
    case ts.SyntaxKind.NewExpression: {
      const ne = expr as ts.NewExpression;
      let callee = emitExpression(ne.expression);
      if (!callee) return null;
      if (ts.isIdentifier(ne.expression) && ne.expression.text === "Error") {
        // TS `Error` maps to `js.lib.Error` on the JS target.
        callee = "js.lib.Error";
      }
      const args = (ne.arguments ?? []).map(emitExpression);
      if (args.some((a) => a == null)) return null;
      return `new ${callee}(${args.join(", ")})`;
    }
    case ts.SyntaxKind.BinaryExpression: {
      const bin = expr as ts.BinaryExpression;
      const left = emitExpression(bin.left);
      const right = emitExpression(bin.right);
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
      const inner = emitExpression(un.operand);
      if (!inner) return null;
      return `!(${inner})`;
    }
    case ts.SyntaxKind.ConditionalExpression: {
      const cond = expr as ts.ConditionalExpression;
      const test = emitExpression(cond.condition);
      const whenTrue = emitExpression(cond.whenTrue);
      const whenFalse = emitExpression(cond.whenFalse);
      if (!test || !whenTrue || !whenFalse) return null;
      return `(${test} ? ${whenTrue} : ${whenFalse})`;
    }
    case ts.SyntaxKind.CallExpression: {
      const call = expr as ts.CallExpression;

      // Best-effort builtin mappings for Haxe-for-JS (v0).
      if (ts.isPropertyAccessExpression(call.expression)) {
        const access = call.expression;
        const left = emitExpression(access.expression);
        if (!left) return null;

        // `JSON.stringify(x)` -> `haxe.Json.stringify(x)`
        if (access.name.text === "stringify" && ts.isIdentifier(access.expression) && access.expression.text === "JSON") {
          if (call.arguments.length !== 1) return null;
          const arg0 = emitExpression(call.arguments[0]);
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
          const arg0 = emitExpression(call.arguments[0]);
          if (!arg0) return null;
          return `trace(${arg0})`;
        }
      }

      const callee = emitExpression(call.expression);
      if (!callee) return null;
      const args = call.arguments.map(emitExpression);
      if (args.some((a) => a == null)) return null;
      return `${callee}(${args.join(", ")})`;
    }
    default:
      return null;
  }
}

function emitStatements(statements: readonly ts.Statement[], indent: string): string | null {
  const out: string[] = [];

  for (const stmt of statements) {
    const emitted = emitStatement(stmt, indent);
    if (emitted == null) return null;
    if (emitted.length > 0) out.push(emitted);
  }

  return out.join("\n");
}

function emitStatement(stmt: ts.Statement, indent: string): string | null {
  if (ts.isBlock(stmt)) {
    const inner = emitStatements(stmt.statements, indent + "  ");
    if (inner == null) return null;
    if (inner.length === 0) return `${indent}{}`;
    return `${indent}{\n${inner}\n${indent}}`;
  }

  if (ts.isReturnStatement(stmt)) {
    if (!stmt.expression) return `${indent}return;`;
    const expr = emitExpression(stmt.expression);
    if (!expr) return null;
    return `${indent}return ${expr};`;
  }

  if (ts.isExpressionStatement(stmt)) {
    const expr = emitExpression(stmt.expression);
    if (!expr) return null;
    return `${indent}${expr};`;
  }

  if (ts.isVariableStatement(stmt)) {
    const decls: string[] = [];
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) return null;
      const name = decl.name.text;
      const init = decl.initializer ? emitExpression(decl.initializer) : null;
      if (!init) return null;
      const typeSuffix = decl.type ? `: ${emitType(decl.type)}` : "";
      decls.push(`${indent}var ${name}${typeSuffix} = ${init};`);
    }
    return decls.join("\n");
  }

  if (ts.isIfStatement(stmt)) {
    const cond = emitExpression(stmt.expression);
    if (!cond) return null;
    const thenPart = emitStatement(stmt.thenStatement, ts.isBlock(stmt.thenStatement) ? indent : indent + "  ");
    if (thenPart == null) return null;
    const thenBlock = ts.isBlock(stmt.thenStatement) ? thenPart : `${indent}{\n${thenPart}\n${indent}}`;

    if (!stmt.elseStatement) return `${indent}if (${cond}) ${thenBlock}`;

    const elsePart = emitStatement(stmt.elseStatement, ts.isBlock(stmt.elseStatement) ? indent : indent + "  ");
    if (elsePart == null) return null;
    const elseBlock = ts.isBlock(stmt.elseStatement) ? elsePart : `${indent}{\n${elsePart}\n${indent}}`;
    return `${indent}if (${cond}) ${thenBlock} else ${elseBlock}`;
  }

  if (ts.isThrowStatement(stmt)) {
    const expr = stmt.expression ? emitExpression(stmt.expression) : null;
    if (!expr) return null;
    return `${indent}throw ${expr};`;
  }

  if (ts.isTryStatement(stmt)) {
    const tryBlock = emitStatement(stmt.tryBlock, indent);
    if (tryBlock == null) return null;
    if (!stmt.catchClause) return null;
    const catchName =
      stmt.catchClause.variableDeclaration && ts.isIdentifier(stmt.catchClause.variableDeclaration.name)
        ? stmt.catchClause.variableDeclaration.name.text
        : "e";
    const catchBody = emitStatement(stmt.catchClause.block, indent);
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
        const init = decl.initializer ? emitExpression(decl.initializer) : null;
        if (!init) return null;
        initLines.push(`${indent}  var ${decl.name.text} = ${init};`);
      }
    } else {
      const init = emitExpression(stmt.initializer);
      if (!init) return null;
      initLines.push(`${indent}  ${init};`);
    }

    const cond = emitExpression(stmt.condition);
    const inc = emitExpression(stmt.incrementor);
    if (!cond || !inc) return null;

    const bodyInner = ts.isBlock(stmt.statement)
      ? emitStatements(stmt.statement.statements, indent + "    ")
      : emitStatement(stmt.statement, indent + "    ");
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

    const iter = emitExpression(stmt.expression);
    if (!iter) return null;

    const bodyPart = emitStatement(stmt.statement, ts.isBlock(stmt.statement) ? indent : indent + "  ");
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
    const emitted = emitStatements(opts.body.statements, "  ");
    if (emitted) body = emitted;
  }

  return `${opts.modifierPrefix}function ${opts.name}(${params.join(", ")})${returnTypeSuffix} {\n${body}\n}`;
}

function emitFunction(fn: ts.FunctionDeclaration): string {
  return emitFunctionLike({
    name: fn.name?.text ?? "anon",
    parameters: fn.parameters,
    returnType: fn.type,
    body: fn.body,
    modifierPrefix: ""
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

function emitClass(decl: ts.ClassDeclaration): string {
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
        omitReturnType: true
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
        modifierPrefix: `  ${visibility} ${isStatic ? "static " : ""}`
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
    if (!clause?.namedBindings) continue;
    if (!ts.isNamedImports(clause.namedBindings)) continue;
    const named = clause.namedBindings.elements.map((el) => ({
      name: el.name.text,
      alias: el.propertyName ? el.propertyName.text : null
    }));
    imports.push({ kind: "named", moduleSpecifier, named });
  }

  return imports;
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

  const imports = collectImports(sf);
  for (const imp of imports) {
    if (!isRelativeModuleSpecifier(imp.moduleSpecifier)) continue;

    const target = moduleTargetFromImport(
      { projectDir: opts.projectDir, rootDir: opts.rootDir, fromFile: absFile, basePackage: opts.basePackage },
      imp.moduleSpecifier
    );

    for (const { name, alias } of imp.named) {
      const effectiveName = alias ?? name;
      if (isLikelyTypeName(effectiveName)) {
        const moduleBase = target.packagePath.length > 0 ? `${target.packagePath}.${target.moduleName}` : target.moduleName;
        const typeImport =
          effectiveName === target.moduleName
            ? target.packagePath.length > 0
              ? `${target.packagePath}.${effectiveName}`
              : effectiveName
            : `${moduleBase}.${effectiveName}`;
        out.push(alias ? `import ${typeImport} as ${name};` : `import ${typeImport};`);
      } else {
        const valueImportBase = target.packagePath.length > 0 ? `${target.packagePath}.${target.moduleName}` : target.moduleName;
        out.push(alias ? `import ${valueImportBase}.${effectiveName} as ${name};` : `import ${valueImportBase}.${effectiveName};`);
      }
    }
  }

  if (imports.length > 0) out.push("");

  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      if (!isExported) continue;

      const declKeyword = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0 ? "final" : "var";
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) return null;
        if (!decl.initializer) return null;
        const init = emitExpression(decl.initializer);
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
      out.push(emitFunction(stmt));
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
      out.push(emitClass(stmt));
      out.push("");
      continue;
    }
  }

  return { filePath: outAbsFile, content: out.join("\n").trimEnd() + "\n" };
}

export function emitProjectToHaxe(opts: EmitHaxeOptions): { writtenFiles: string[] } {
  const writtenFiles: string[] = [];
  fs.mkdirSync(opts.outDir, { recursive: true });

  for (const sf of opts.sourceFiles.slice().sort((a, b) => a.fileName.localeCompare(b.fileName))) {
    const emitted = emitHaxeSourceFile(opts, sf);
    if (!emitted) continue;
    fs.mkdirSync(path.dirname(emitted.filePath), { recursive: true });
    fs.writeFileSync(emitted.filePath, emitted.content, "utf8");
    writtenFiles.push(emitted.filePath);
  }

  return { writtenFiles };
}
