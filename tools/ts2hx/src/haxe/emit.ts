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
      if (ts.isIdentifier(ref.typeName)) return ref.typeName.text;
      if (ts.isQualifiedName(ref.typeName)) return ref.typeName.right.text;
      return "Dynamic";
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
    case ts.SyntaxKind.PropertyAccessExpression: {
      const access = expr as ts.PropertyAccessExpression;
      const left = emitExpression(access.expression);
      if (!left) return null;
      return `${left}.${access.name.text}`;
    }
    case ts.SyntaxKind.NewExpression: {
      const ne = expr as ts.NewExpression;
      const callee = emitExpression(ne.expression);
      if (!callee) return null;
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
      if (
        op === ts.SyntaxKind.PlusToken ||
        op === ts.SyntaxKind.MinusToken ||
        op === ts.SyntaxKind.AsteriskToken ||
        op === ts.SyntaxKind.SlashToken
      ) {
        const opText = ts.tokenToString(op) ?? "+";
        return `(${left} ${opText} ${right})`;
      }
      return null;
    }
    case ts.SyntaxKind.CallExpression: {
      const call = expr as ts.CallExpression;
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
    if (ts.isReturnStatement(stmt)) {
      if (!stmt.expression) {
        out.push(`${indent}return;`);
        continue;
      }
      const expr = emitExpression(stmt.expression);
      if (!expr) return null;
      out.push(`${indent}return ${expr};`);
      continue;
    }

    if (ts.isExpressionStatement(stmt)) {
      const expr = emitExpression(stmt.expression);
      if (!expr) return null;
      out.push(`${indent}${expr};`);
      continue;
    }

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) return null;
        const name = decl.name.text;
        const init = decl.initializer ? emitExpression(decl.initializer) : null;
        if (!init) return null;
        out.push(`${indent}var ${name} = ${init};`);
      }
      continue;
    }

    return null;
  }

  return out.join("\n");
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
