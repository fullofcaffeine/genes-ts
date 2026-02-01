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
  tmpCounter: number;
};

function nextTmp(ctx: EmitContext, prefix = "__ts2hx_tmp"): string {
  const n = ctx.tmpCounter;
  ctx.tmpCounter++;
  return `${prefix}${n}`;
}

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

type BindingMode = "declare" | "assign";

type DeclareKeyword = "var" | "final";

function emitBindingTarget(expr: ts.Expression): string | null {
  if (ts.isParenthesizedExpression(expr)) return emitBindingTarget(expr.expression);
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    const left = emitBindingTarget(expr.expression);
    if (!left) return null;
    return `${left}.${expr.name.text}`;
  }
  if (ts.isElementAccessExpression(expr)) {
    const left = emitBindingTarget(expr.expression);
    if (!left || !expr.argumentExpression || !ts.isStringLiteral(expr.argumentExpression)) return null;
    return `${left}[${JSON.stringify(expr.argumentExpression.text)}]`;
  }
  return null;
}

function canDotAccessField(name: string): boolean {
  return isValidHaxeIdentifier(name) && !HAXE_RESERVED.has(name);
}

function emitDestructureFromBindingName(opts: {
  ctx: EmitContext;
  mode: BindingMode;
  declareKeyword?: DeclareKeyword;
  name: ts.BindingName;
  valueExpr: string;
  indent: string;
}): string[] | null {
  const { ctx, mode, name, valueExpr, indent } = opts;
  const declareKeyword: DeclareKeyword = opts.declareKeyword ?? "var";
  const out: string[] = [];

  if (ts.isIdentifier(name)) {
    out.push(
      mode === "declare"
        ? `${indent}${declareKeyword} ${name.text} = ${valueExpr};`
        : `${indent}${name.text} = ${valueExpr};`
    );
    return out;
  }

  if (ts.isObjectBindingPattern(name)) {
    const takenKeys: string[] = [];

    for (const el of name.elements) {
      if (el.dotDotDotToken) {
        if (!ts.isIdentifier(el.name)) return null;
        const restName = el.name.text;
        out.push(`${indent}${declareKeyword} ${restName} = js.lib.Object.assign(cast {}, ${valueExpr});`);
        for (const k of takenKeys) out.push(`${indent}Reflect.deleteField(${restName}, ${JSON.stringify(k)});`);
        continue;
      }

      const key =
        el.propertyName && ts.isIdentifier(el.propertyName)
          ? el.propertyName.text
          : el.propertyName && ts.isStringLiteral(el.propertyName)
            ? el.propertyName.text
            : ts.isIdentifier(el.name)
              ? el.name.text
              : null;
      if (!key) return null;
      takenKeys.push(key);

      const access = canDotAccessField(key) ? `${valueExpr}.${key}` : `${valueExpr}[${JSON.stringify(key)}]`;

      const rawTmp = nextTmp(ctx);
      out.push(`${indent}var ${rawTmp} = ${access};`);

      let effectiveValue = rawTmp;
      if (el.initializer) {
        const def = emitExpression(ctx, el.initializer);
        if (!def) return null;
        effectiveValue = `(${rawTmp} == null ? ${def} : ${rawTmp})`;
      }

      const targetName = el.name;
      if (ts.isIdentifier(targetName)) {
        out.push(
          mode === "declare"
            ? `${indent}${declareKeyword} ${targetName.text} = ${effectiveValue};`
            : `${indent}${targetName.text} = ${effectiveValue};`
        );
      } else {
        const nestedTmp = nextTmp(ctx);
        out.push(`${indent}var ${nestedTmp}: Dynamic = ${effectiveValue};`);
        const nested = emitDestructureFromBindingName({ ctx, mode, declareKeyword, name: targetName, valueExpr: nestedTmp, indent });
        if (!nested) return null;
        out.push(...nested);
      }
    }

    return out;
  }

  if (ts.isArrayBindingPattern(name)) {
    let index = 0;
    for (const el of name.elements) {
      if (ts.isOmittedExpression(el)) {
        index++;
        continue;
      }

      if (el.dotDotDotToken) {
        if (!ts.isIdentifier(el.name)) return null;
        const restName = el.name.text;
        out.push(`${indent}${declareKeyword} ${restName} = ${valueExpr}.slice(${index});`);
        continue;
      }

      const access = `${valueExpr}[${index}]`;
      index++;

      const rawTmp = nextTmp(ctx);
      out.push(`${indent}var ${rawTmp} = ${access};`);

      let effectiveValue = rawTmp;
      if (el.initializer) {
        const def = emitExpression(ctx, el.initializer);
        if (!def) return null;
        effectiveValue = `(${rawTmp} == null ? ${def} : ${rawTmp})`;
      }

      if (ts.isIdentifier(el.name)) {
        out.push(
          mode === "declare"
            ? `${indent}${declareKeyword} ${el.name.text} = ${effectiveValue};`
            : `${indent}${el.name.text} = ${effectiveValue};`
        );
      } else {
        const nestedTmp = nextTmp(ctx);
        out.push(`${indent}var ${nestedTmp}: Dynamic = ${effectiveValue};`);
        const nested = emitDestructureFromBindingName({ ctx, mode, declareKeyword, name: el.name, valueExpr: nestedTmp, indent });
        if (!nested) return null;
        out.push(...nested);
      }
    }

    return out;
  }

  return null;
}

function emitDestructureAssignmentFromExpression(opts: {
  ctx: EmitContext;
  pattern: ts.Expression;
  valueExpr: string;
  indent: string;
}): string[] | null {
  const { ctx, pattern, valueExpr, indent } = opts;
  const out: string[] = [];

  if (ts.isParenthesizedExpression(pattern)) {
    return emitDestructureAssignmentFromExpression({ ctx, pattern: pattern.expression, valueExpr, indent });
  }

  if (ts.isObjectLiteralExpression(pattern)) {
    const takenKeys: string[] = [];
    for (const prop of pattern.properties) {
      if (ts.isSpreadAssignment(prop)) {
        const target = emitBindingTarget(prop.expression);
        if (!target) return null;
        out.push(`${indent}${target} = js.lib.Object.assign(cast {}, ${valueExpr});`);
        for (const k of takenKeys) out.push(`${indent}Reflect.deleteField(${target}, ${JSON.stringify(k)});`);
        continue;
      }

      if (ts.isShorthandPropertyAssignment(prop)) {
        const key = prop.name.text;
        takenKeys.push(key);
        const access = canDotAccessField(key) ? `${valueExpr}.${key}` : `${valueExpr}[${JSON.stringify(key)}]`;
        const rawTmp = nextTmp(ctx);
        out.push(`${indent}var ${rawTmp} = ${access};`);
        if (prop.objectAssignmentInitializer) {
          const def = emitExpression(ctx, prop.objectAssignmentInitializer);
          if (!def) return null;
          out.push(`${indent}${key} = (${rawTmp} == null ? ${def} : ${rawTmp});`);
        } else {
          out.push(`${indent}${key} = ${rawTmp};`);
        }
        continue;
      }

      if (ts.isPropertyAssignment(prop)) {
        const key =
          ts.isIdentifier(prop.name)
            ? prop.name.text
            : ts.isStringLiteral(prop.name)
              ? prop.name.text
              : null;
        if (!key) return null;
        takenKeys.push(key);

        const access = canDotAccessField(key) ? `${valueExpr}.${key}` : `${valueExpr}[${JSON.stringify(key)}]`;

        // Defaults in assignment patterns: `{a: b = 1} = obj` or `{a: {b} = {}} = obj`.
        if (ts.isBinaryExpression(prop.initializer) && prop.initializer.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          const rhsTmp = nextTmp(ctx);
          out.push(`${indent}var ${rhsTmp} = ${access};`);
          const def = emitExpression(ctx, prop.initializer.right);
          if (!def) return null;
          const effectiveValue = `(${rhsTmp} == null ? ${def} : ${rhsTmp})`;

          const left = prop.initializer.left;
          if (ts.isObjectLiteralExpression(left) || ts.isArrayLiteralExpression(left)) {
            const nestedTmp = nextTmp(ctx);
            out.push(`${indent}var ${nestedTmp}: Dynamic = ${effectiveValue};`);
            const nested = emitDestructureAssignmentFromExpression({ ctx, pattern: left, valueExpr: nestedTmp, indent });
            if (!nested) return null;
            out.push(...nested);
            continue;
          }

          const target = emitBindingTarget(left);
          if (!target) return null;
          out.push(`${indent}${target} = ${effectiveValue};`);
          continue;
        }

        if (ts.isObjectLiteralExpression(prop.initializer) || ts.isArrayLiteralExpression(prop.initializer)) {
          const nestedTmp = nextTmp(ctx);
          out.push(`${indent}var ${nestedTmp}: Dynamic = ${access};`);
          const nested = emitDestructureAssignmentFromExpression({ ctx, pattern: prop.initializer, valueExpr: nestedTmp, indent });
          if (!nested) return null;
          out.push(...nested);
          continue;
        }

        const target = emitBindingTarget(prop.initializer);
        if (!target) return null;
        out.push(`${indent}${target} = ${access};`);
        continue;
      }

      return null;
    }

    return out;
  }

  if (ts.isArrayLiteralExpression(pattern)) {
    let index = 0;
    for (const el of pattern.elements) {
      if (ts.isOmittedExpression(el)) {
        index++;
        continue;
      }
      if (ts.isSpreadElement(el)) {
        const target = emitBindingTarget(el.expression);
        if (!target) return null;
        out.push(`${indent}${target} = ${valueExpr}.slice(${index});`);
        continue;
      }

      const access = `${valueExpr}[${index}]`;
      index++;

      // Defaults in assignment patterns: `[a = 1] = arr` or `[{a} = {}] = arr`.
      if (ts.isBinaryExpression(el) && el.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const rhsTmp = nextTmp(ctx);
        out.push(`${indent}var ${rhsTmp} = ${access};`);
        const def = emitExpression(ctx, el.right);
        if (!def) return null;
        const effectiveValue = `(${rhsTmp} == null ? ${def} : ${rhsTmp})`;

        const left = el.left;
        if (ts.isObjectLiteralExpression(left) || ts.isArrayLiteralExpression(left)) {
          const nestedTmp = nextTmp(ctx);
          out.push(`${indent}var ${nestedTmp}: Dynamic = ${effectiveValue};`);
          const nested = emitDestructureAssignmentFromExpression({ ctx, pattern: left, valueExpr: nestedTmp, indent });
          if (!nested) return null;
          out.push(...nested);
          continue;
        }

        const target = emitBindingTarget(left);
        if (!target) return null;
        out.push(`${indent}${target} = ${effectiveValue};`);
        continue;
      }

      if (ts.isObjectLiteralExpression(el) || ts.isArrayLiteralExpression(el)) {
        const nestedTmp = nextTmp(ctx);
        out.push(`${indent}var ${nestedTmp}: Dynamic = ${access};`);
        const nested = emitDestructureAssignmentFromExpression({ ctx, pattern: el, valueExpr: nestedTmp, indent });
        if (!nested) return null;
        out.push(...nested);
        continue;
      }

      const target = emitBindingTarget(el);
      if (!target) return null;
      out.push(`${indent}${target} = ${access};`);
    }

    return out;
  }

  return null;
}

function emitType(typeNode: ts.TypeNode | undefined): string {
  if (!typeNode) return "Dynamic";

  function emitTypeName(typeName: ts.EntityName): string | null {
    if (ts.isIdentifier(typeName)) return typeName.text;
    if (ts.isQualifiedName(typeName)) {
      const left = emitTypeName(typeName.left);
      if (!left) return null;
      return `${left}.${typeName.right.text}`;
    }
    return null;
  }

  function eitherType(items: string[]): string {
    const cleaned = items.filter((t) => t !== "Dynamic");
    if (cleaned.length === 0) return "Dynamic";
    if (cleaned.length === 1) return cleaned[0] as string;

    let out = `haxe.extern.EitherType<${cleaned[0]}, ${cleaned[1]}>`;
    for (const next of cleaned.slice(2)) out = `haxe.extern.EitherType<${out}, ${next}>`;
    return out;
  }

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
      const baseName = emitTypeName(ref.typeName);
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
    case ts.SyntaxKind.FunctionType: {
      const fn = typeNode as ts.FunctionTypeNode;
      const argTypes = fn.parameters.map((p) => {
        const t = emitType(p.type);
        const base = p.dotDotDotToken ? `haxe.extern.Rest<${t}>` : t;
        return p.questionToken ? `Null<${base}>` : base;
      });
      const ret = emitType(fn.type);
      if (argTypes.length === 0) return `Void->${ret}`;
      return [...argTypes, ret].join("->");
    }
    case ts.SyntaxKind.UnionType: {
      const un = typeNode as ts.UnionTypeNode;

      // Support `T | null | undefined` as `Null<T>` best-effort.
      const nonNullable = un.types.filter(
        (t) => t.kind !== ts.SyntaxKind.NullKeyword && t.kind !== ts.SyntaxKind.UndefinedKeyword
      );
      const hadNullable = nonNullable.length !== un.types.length;

      // Simple literal unions.
      const stringLits: string[] = [];
      const numberLits: string[] = [];
      let boolOnly = true;
      for (const t of nonNullable) {
        if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) {
          stringLits.push(t.literal.text);
          boolOnly = false;
          continue;
        }
        if (ts.isLiteralTypeNode(t) && ts.isNumericLiteral(t.literal)) {
          numberLits.push(t.literal.text);
          boolOnly = false;
          continue;
        }
        if (t.kind === ts.SyntaxKind.TrueKeyword || t.kind === ts.SyntaxKind.FalseKeyword) continue;
        boolOnly = false;
      }

      if (boolOnly && nonNullable.length > 0) return hadNullable ? "Null<Bool>" : "Bool";
      if (stringLits.length === nonNullable.length && nonNullable.length > 0) return hadNullable ? "Null<String>" : "String";
      if (numberLits.length === nonNullable.length && nonNullable.length > 0) return hadNullable ? "Null<Float>" : "Float";

      const emitted = nonNullable.map((t) => emitType(t));
      const core = eitherType(emitted);
      return hadNullable ? `Null<${core}>` : core;
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
      if (name === "undefined") return "null";
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
      const prelude: string[] = [];
      const params = fn.parameters.map((p, index) => {
        const isRest = !!p.dotDotDotToken;
        const hasDefault = !!p.initializer;
        const isOptional = !!p.questionToken || hasDefault;

        const baseType = emitType(p.type);
        const paramType = isRest ? `haxe.extern.Rest<${baseType}>` : baseType;

        const paramName = ts.isIdentifier(p.name) ? p.name.text : `_p${index}`;
        const namePrefix = isOptional ? "?" : "";
        const typeSuffix = p.type || isRest ? `: ${paramType}` : "";

        if (hasDefault) {
          const def = emitExpression(ctx, p.initializer as ts.Expression);
          if (!def) return null;
          prelude.push(`  if (${paramName} == null) ${paramName} = ${def};`);
        }

        if (!ts.isIdentifier(p.name)) {
          const srcTmp = nextTmp(ctx);
          prelude.push(`  var ${srcTmp} = ${paramName};`);
          const destructured = emitDestructureFromBindingName({
            ctx,
            mode: "declare",
            declareKeyword: "var",
            name: p.name,
            valueExpr: srcTmp,
            indent: "  "
          });
          if (!destructured) return null;
          prelude.push(...destructured);
        }

        return `${namePrefix}${paramName}${typeSuffix}`;
      });
      if (params.some((p) => p == null)) return null;

      if (ts.isBlock(fn.body)) {
        const body = emitStatements(ctx, fn.body.statements, "  ");
        if (body == null) return null;
        const merged = prelude.length > 0 ? (body.length > 0 ? `${prelude.join("\n")}\n${body}` : prelude.join("\n")) : body;
        return `function(${params.join(", ")}) {\n${merged}\n}`;
      }

      const bodyExpr = emitExpression(ctx, fn.body);
      if (!bodyExpr) return null;
      if (prelude.length === 0) return `function(${params.join(", ")}) return ${bodyExpr}`;

      return `function(${params.join(", ")}) {\n${prelude.join("\n")}\n  return ${bodyExpr};\n}`;
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
      const op = bin.operatorToken.kind;

      // Destructuring assignment: `({a, b} = obj)` / `([a, b] = arr)`.
      if (op === ts.SyntaxKind.EqualsToken) {
        const rhs = emitExpression(ctx, bin.right);
        if (!rhs) return null;

        const pattern = ts.isParenthesizedExpression(bin.left) ? bin.left.expression : bin.left;
        if (ts.isObjectLiteralExpression(pattern) || ts.isArrayLiteralExpression(pattern)) {
          const tmp = nextTmp(ctx);
          const body: string[] = [];
          body.push(`  var ${tmp} = ${rhs};`);
          const assigns = emitDestructureAssignmentFromExpression({ ctx, pattern, valueExpr: tmp, indent: "  " });
          if (!assigns) return null;
          body.push(...assigns);
          body.push(`  return null;`);
          return `(function() {\n${body.join("\n")}\n})()`;
        }
      }

      const left = emitExpression(ctx, bin.left);
      const right = emitExpression(ctx, bin.right);
      if (!left || !right) return null;
      if (op === ts.SyntaxKind.EqualsToken) {
        return `${left} = ${right}`;
      }
      if (
        op === ts.SyntaxKind.PlusEqualsToken ||
        op === ts.SyntaxKind.MinusEqualsToken ||
        op === ts.SyntaxKind.AsteriskEqualsToken ||
        op === ts.SyntaxKind.SlashEqualsToken
      ) {
        const opText = ts.tokenToString(op)?.replace("=", "") ?? "+";
        return `(${left} = (${left} ${opText} ${right}))`;
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
      const inner = emitExpression(ctx, un.operand);
      if (!inner) return null;
      switch (un.operator) {
        case ts.SyntaxKind.ExclamationToken:
          return `!(${inner})`;
        case ts.SyntaxKind.PlusToken:
          // Haxe has no unary plus operator; best-effort: preserve the operand.
          // (JS numeric coercion is intentionally not modeled here yet.)
          return `(${inner})`;
        case ts.SyntaxKind.MinusToken:
          return `-(${inner})`;
        case ts.SyntaxKind.PlusPlusToken:
          return `++${inner}`;
        case ts.SyntaxKind.MinusMinusToken:
          return `--${inner}`;
        default:
          return null;
      }
    }
    case ts.SyntaxKind.PostfixUnaryExpression: {
      const un = expr as ts.PostfixUnaryExpression;
      const inner = emitExpression(ctx, un.operand);
      if (!inner) return null;
      switch (un.operator) {
        case ts.SyntaxKind.PlusPlusToken:
          return `${inner}++`;
        case ts.SyntaxKind.MinusMinusToken:
          return `${inner}--`;
        default:
          return null;
      }
    }
    case ts.SyntaxKind.TypeOfExpression: {
      const t = expr as ts.TypeOfExpression;
      const inner = emitExpression(ctx, t.expression);
      if (!inner) return null;
      return `js.Syntax.typeof(${inner})`;
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
    const keyword = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0 ? "final" : "var";
    const decls: string[] = [];
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        const name = decl.name.text;
        const typeSuffix = decl.type ? `: ${emitType(decl.type)}` : "";

        if (decl.initializer) {
          const init = emitExpression(ctx, decl.initializer);
          if (!init) return null;
          decls.push(`${indent}${keyword} ${name}${typeSuffix} = ${init};`);
          continue;
        }

        // TS allows `let x;` (no initializer). Prefer a best-effort default initializer so downstream
        // statement emission can compile without needing a full definite-assignment analysis.
        let defaultInit: string | null = null;
        if (decl.type) {
          switch (decl.type.kind) {
            case ts.SyntaxKind.NumberKeyword:
              defaultInit = "0";
              break;
            case ts.SyntaxKind.StringKeyword:
              defaultInit = JSON.stringify("");
              break;
            case ts.SyntaxKind.BooleanKeyword:
              defaultInit = "false";
              break;
            case ts.SyntaxKind.ArrayType:
              defaultInit = "[]";
              break;
            default:
              defaultInit = "cast null";
              break;
          }
        } else {
          defaultInit = "null";
        }

        decls.push(`${indent}${keyword} ${name}${typeSuffix} = ${defaultInit};`);
        continue;
      }

      if (!decl.initializer) return null;
      const init = emitExpression(ctx, decl.initializer);
      if (!init) return null;
      const tmp = nextTmp(ctx);
      const tmpTypeSuffix = decl.type ? `: ${emitType(decl.type)}` : "";
      decls.push(`${indent}${keyword} ${tmp}${tmpTypeSuffix} = ${init};`);
      const destructured = emitDestructureFromBindingName({
        ctx,
        mode: "declare",
        declareKeyword: keyword,
        name: decl.name,
        valueExpr: tmp,
        indent
      });
      if (!destructured) return null;
      decls.push(...destructured);
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

  if (ts.isBreakStatement(stmt)) {
    return `${indent}break;`;
  }

  if (ts.isContinueStatement(stmt)) {
    return `${indent}continue;`;
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

  if (ts.isWhileStatement(stmt)) {
    const cond = emitExpression(ctx, stmt.expression);
    if (!cond) return null;
    const bodyPart = emitStatement(ctx, stmt.statement, ts.isBlock(stmt.statement) ? indent : indent + "  ");
    if (bodyPart == null) return null;
    const bodyBlock = ts.isBlock(stmt.statement) ? bodyPart : `${indent}{\n${bodyPart}\n${indent}}`;
    return `${indent}while (${cond}) ${bodyBlock}`;
  }

  if (ts.isDoStatement(stmt)) {
    const cond = emitExpression(ctx, stmt.expression);
    if (!cond) return null;
    const bodyPart = emitStatement(ctx, stmt.statement, ts.isBlock(stmt.statement) ? indent : indent + "  ");
    if (bodyPart == null) return null;
    const bodyBlock = ts.isBlock(stmt.statement) ? bodyPart : `${indent}{\n${bodyPart}\n${indent}}`;
    return `${indent}do ${bodyBlock} while (${cond});`;
  }

  if (ts.isSwitchStatement(stmt)) {
    const expr = emitExpression(ctx, stmt.expression);
    if (!expr) return null;

    const lines: string[] = [];
    lines.push(`${indent}switch (${expr}) {`);

    const pendingLabels: string[] = [];
    function flushCase(labels: string[], statements: readonly ts.Statement[]): boolean {
      if (labels.length === 0) return true;
      const caseLabel = labels.join(", ");
      const trimmed =
        statements.length > 0 && ts.isBreakStatement(statements[statements.length - 1] as ts.Statement)
          ? statements.slice(0, -1)
          : statements;
      const body = emitStatements(ctx, trimmed, indent + "    ");
      if (body == null) return false;
      lines.push(`${indent}  case ${caseLabel}:`);
      if (body.length === 0) lines.push(`${indent}    {}`);
      else lines.push(`${indent}    {\n${body}\n${indent}    }`);
      return true;
    }

    let defaultStatements: readonly ts.Statement[] | null = null;

    for (const clause of stmt.caseBlock.clauses) {
      if (ts.isCaseClause(clause)) {
        const label = emitExpression(ctx, clause.expression);
        if (!label) return null;
        pendingLabels.push(label);
        if (clause.statements.length === 0) continue;
        if (!flushCase(pendingLabels.splice(0, pendingLabels.length), clause.statements)) return null;
        continue;
      }

      // default
      if (pendingLabels.length > 0) {
        // A fallthrough chain into default is not representable in Haxe switch without rewriting.
        // Flush as an empty case block so compilation can continue (best-effort semantics).
        if (!flushCase(pendingLabels.splice(0, pendingLabels.length), [])) return null;
      }
      defaultStatements = clause.statements;
    }

    if (pendingLabels.length > 0 && !flushCase(pendingLabels.splice(0, pendingLabels.length), [])) return null;

    if (defaultStatements) {
      const trimmed =
        defaultStatements.length > 0 && ts.isBreakStatement(defaultStatements[defaultStatements.length - 1] as ts.Statement)
          ? defaultStatements.slice(0, -1)
          : defaultStatements;
      const body = emitStatements(ctx, trimmed, indent + "    ");
      if (body == null) return null;
      lines.push(`${indent}  default:`);
      if (body.length === 0) lines.push(`${indent}    {}`);
      else lines.push(`${indent}    {\n${body}\n${indent}    }`);
    }

    lines.push(`${indent}}`);
    return lines.join("\n");
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
}): string | null {
  const prelude: string[] = [];
  const params: string[] = [];

  for (let index = 0; index < opts.parameters.length; index++) {
    const p = opts.parameters[index] as ts.ParameterDeclaration;
    const isRest = !!p.dotDotDotToken;
    const hasDefault = !!p.initializer;
    const isOptional = !!p.questionToken || hasDefault;

    const baseType = emitType(p.type);
    const paramType = isRest ? `haxe.extern.Rest<${baseType}>` : baseType;

    const paramName = ts.isIdentifier(p.name) ? p.name.text : `_p${index}`;
    const namePrefix = isOptional ? "?" : "";
    const typeSuffix = p.type || isRest ? `: ${paramType}` : "";

    if (hasDefault) {
      const def = emitExpression(opts.ctx, p.initializer as ts.Expression);
      if (!def) return null;
      prelude.push(`  if (${paramName} == null) ${paramName} = ${def};`);
    }

    if (!ts.isIdentifier(p.name)) {
      const srcTmp = nextTmp(opts.ctx);
      prelude.push(`  var ${srcTmp} = ${paramName};`);
      const destructured = emitDestructureFromBindingName({
        ctx: opts.ctx,
        mode: "declare",
        declareKeyword: "var",
        name: p.name,
        valueExpr: srcTmp,
        indent: "  "
      });
      if (!destructured) return null;
      prelude.push(...destructured);
    }

    params.push(`${namePrefix}${paramName}${typeSuffix}`);
  }

  const returnType = emitType(opts.returnType);
  const returnTypeSuffix = opts.omitReturnType ? "" : `: ${returnType}`;

  let body = `  throw "ts2hx: unsupported";`;
  if (opts.body) {
    const emitted = emitStatements(opts.ctx, opts.body.statements, "  ");
    if (emitted != null) body = emitted.length > 0 ? emitted : "";
  }
  if (prelude.length > 0) body = body.length > 0 ? `${prelude.join("\n")}\n${body}` : prelude.join("\n");

  return `${opts.modifierPrefix}function ${opts.name}(${params.join(", ")})${returnTypeSuffix} {\n${body}\n}`;
}

function emitFunction(ctx: EmitContext, fn: ts.FunctionDeclaration): string | null {
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

function emitClass(ctx: EmitContext, decl: ts.ClassDeclaration, forcedName?: string): string | null {
  const name = forcedName ?? decl.name?.text ?? "AnonymousClass";
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
      if (!emitted) return null;
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
      if (!emitted) return null;
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

type LocalExportSpec = { exported: string; source: string; isTypeOnly: boolean };

function collectLocalExports(sf: ts.SourceFile): LocalExportSpec[] {
  const exports: LocalExportSpec[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt)) continue;
    if (stmt.moduleSpecifier) continue;
    if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) continue;

    for (const el of stmt.exportClause.elements) {
      exports.push({
        exported: el.name.text,
        source: el.propertyName ? el.propertyName.text : el.name.text,
        isTypeOnly: (stmt.isTypeOnly ?? false) || (el.isTypeOnly ?? false)
      });
    }
  }

  return exports;
}

function collectLocalDeclarationKinds(sf: ts.SourceFile): Map<string, ExportKind> {
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
      set(stmt.name.text, "value");
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) set(decl.name.text, "value");
      }
      continue;
    }
    if (ts.isInterfaceDeclaration(stmt)) {
      set(stmt.name.text, "type");
      continue;
    }
    if (ts.isTypeAliasDeclaration(stmt)) {
      set(stmt.name.text, "type");
      continue;
    }
    if (ts.isEnumDeclaration(stmt)) {
      set(stmt.name.text, "both");
      continue;
    }
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      set(stmt.name.text, "both");
      continue;
    }
  }

  return kinds;
}

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

  const ctx: EmitContext = { identifierRewrites: new Map(), tmpCounter: 0 };

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

  const localExports = collectLocalExports(sf);
  const localExportSources = new Set(localExports.map((e) => e.source).filter((s) => s !== "default"));
  const localDeclKinds = collectLocalDeclarationKinds(sf);
  const localClassNames = new Set(
    sf.statements
      .filter((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && !!s.name)
      .map((s) => (s.name as ts.Identifier).text)
  );

  function uniqueTopLevelTypeName(base: string): string {
    const used = new Set(localDeclKinds.keys());
    let name = base;
    let i = 2;
    while (used.has(name)) {
      name = `${base}${i}`;
      i++;
    }
    return name;
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
      const declNames = stmt.declarationList.declarations
        .map((d) => (ts.isIdentifier(d.name) ? d.name.text : null))
        .filter((n): n is string => !!n);
      const isLocalExported = declNames.some((n) => localExportSources.has(n));
      if (!isExported && !isLocalExported) continue;

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
      const isDefault = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
      const isLocalExported = !!stmt.name && localExportSources.has(stmt.name.text);
      if (!isExported && !isLocalExported) continue;

      if (isDefault && !stmt.name) {
        const params = stmt.parameters.map((p) => {
          const id = ts.isIdentifier(p.name) ? p.name.text : "arg";
          const isOptional = !!p.questionToken;
          const type = emitType(p.type);
          return `${isOptional ? "?" : ""}${id}: ${type}`;
        });

        let fn: string | null = null;
        if (stmt.body && stmt.body.statements.length === 1 && ts.isReturnStatement(stmt.body.statements[0])) {
          const ret = stmt.body.statements[0] as ts.ReturnStatement;
          if (!ret.expression) return null;
          const retExpr = emitExpression(ctx, ret.expression);
          if (!retExpr) return null;
          fn = `function(${params.join(", ")}) return ${retExpr}`;
        } else if (stmt.body) {
          const body = emitStatements(ctx, stmt.body.statements, "  ");
          if (body == null) return null;
          fn = `function(${params.join(", ")}) {\n${body}\n}`;
        } else {
          return null;
        }

        out.push(`final __default = ${fn};`);
      } else {
        const emitted = emitFunction(ctx, stmt);
        if (!emitted) return null;
        out.push(emitted);
        if (isDefault) {
          if (!stmt.name) return null;
          out.push(`final __default = ${stmt.name.text};`);
        }
      }
      out.push("");
      continue;
    }

    if (ts.isTypeAliasDeclaration(stmt)) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      const isLocalExported = localExportSources.has(stmt.name.text);
      if (!isExported && !isLocalExported) continue;
      out.push(emitTypeAlias(stmt));
      out.push("");
      continue;
    }

    if (ts.isInterfaceDeclaration(stmt)) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      const isLocalExported = localExportSources.has(stmt.name.text);
      if (!isExported && !isLocalExported) continue;
      out.push(emitInterface(stmt));
      out.push("");
      continue;
    }

    if (ts.isEnumDeclaration(stmt)) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      const isLocalExported = localExportSources.has(stmt.name.text);
      if (!isExported && !isLocalExported) continue;
      out.push(emitEnum(stmt));
      out.push("");
      continue;
    }

    if (ts.isClassDeclaration(stmt)) {
      const isExported = (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0;
      const isDefault = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
      const isLocalExported = !!stmt.name && localExportSources.has(stmt.name.text);
      if (!isExported && !isLocalExported) continue;

      if (isDefault && !stmt.name) {
        const generatedName = uniqueTopLevelTypeName("DefaultExport");
        const emitted = emitClass(ctx, stmt, generatedName);
        if (!emitted) return null;
        out.push(emitted);
        out.push(`final __default = ${generatedName};`);
      } else {
        const emitted = emitClass(ctx, stmt);
        if (!emitted) return null;
        out.push(emitted);
        if (isDefault) {
          if (!stmt.name) return null;
          out.push(`final __default = ${stmt.name.text};`);
        }
      }
      out.push("");
      continue;
    }
  }

  if (localExports.length > 0) {
    const emitted = new Set<string>();
    for (const exp of localExports) {
      const exportedHx = exp.exported === "default" ? "__default" : exp.exported;
      const sourceHx = exp.source === "default" ? "__default" : exp.source;

      if (exportedHx === "__default" && sourceHx === "__default") continue;
      if (exportedHx === sourceHx && exportedHx !== "__default") continue;
      if (emitted.has(exportedHx)) continue;
      emitted.add(exportedHx);

      const kind: ExportKind =
        exp.isTypeOnly ? "type" : (localDeclKinds.get(exp.source) ?? (isLikelyTypeName(exp.exported) ? "type" : "value"));

      if (exportedHx === "__default") {
        out.push(`final __default = ${sourceHx};`);
        out.push("");
        continue;
      }

      if (kind === "type") out.push(`typedef ${exportedHx} = ${sourceHx};`);
      else if (kind === "both") {
        // Haxe does not allow emitting a type alias and a value alias with the same identifier in a module.
        // For local classes, approximate TS' "type+value" export by generating a thin subclass.
        // (This preserves a usable type and a usable runtime value, but is not a perfect alias.)
        if (localClassNames.has(exp.source)) out.push(`class ${exportedHx} extends ${sourceHx} {}`);
        else out.push(`final ${exportedHx} = ${sourceHx};`);
      } else out.push(`final ${exportedHx} = ${sourceHx};`);
      out.push("");
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
