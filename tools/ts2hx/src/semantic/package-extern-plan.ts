/**
 * Immutable, production-neutral facts for a possible strong package boundary.
 *
 * This module deliberately has no emitter dependency. It lets tests prove a
 * closed typed subset while bound package requests remain fail-closed, so a
 * later architecture decision can adopt, revise, or remove the plan without
 * silently changing generated Haxe.
 */
import path from "node:path";
import ts from "../typescript-api.js";

/**
 * Strong Haxe types admitted by the first package-extern shadow boundary.
 *
 * Why: TypeScript can describe far more types than ordinary Haxe can preserve
 * without generated declarations or weak escape hatches. A closed algebra
 * makes accidental `Dynamic` fallback impossible.
 *
 * What: JavaScript numbers intentionally map to `Float`; this matches Haxe's
 * JS numeric model. `Void` is valid only as a function result.
 *
 * How: the planner below inspects checker `TypeFlags` and constructs one of
 * these literal values. Printers are not allowed to parse TypeScript text to
 * recover a type later.
 */
export type PackageExternHaxeType = "Bool" | "Float" | "String" | "Void";

/** Original source occurrence that owns a future diagnostic or binding. */
export type PackageExternSource = Readonly<{
  file: string;
  start: number;
  end: number;
  line: number;
  column: number;
}>;

export type PackageExternParameterPlan = Readonly<{
  /** Parameter names are not runtime identities, so deterministic names avoid TS/Haxe keyword drift. */
  name: string;
  type: Exclude<PackageExternHaxeType, "Void">;
}>;

type PackageExternPlanIdentity = Readonly<{
  moduleSpecifier: string;
  runtimeExportName: string;
  localReference: string;
  declarationName: string;
  declarationFile: string;
  source: PackageExternSource;
}>;

export type SupportedPackageExternBindingPlan = PackageExternPlanIdentity & Readonly<{
  disposition: "supported";
  member:
    | Readonly<{
        kind: "function";
        parameters: readonly PackageExternParameterPlan[];
        returnType: PackageExternHaxeType;
      }>
    | Readonly<{
        kind: "readonly-value";
        valueType: Exclude<PackageExternHaxeType, "Void">;
      }>;
}>;

export type PackageExternRejectionReason =
  | "missing-symbol"
  | "alias-cycle"
  | "type-only-symbol"
  | "implementation-source"
  | "mutable-export"
  | "overloaded-function"
  | "merged-declaration"
  | "generic-function"
  | "explicit-this-parameter"
  | "optional-parameter"
  | "rest-parameter"
  | "unsupported-parameter-declaration"
  | "unsupported-parameter-type"
  | "unsupported-return-type"
  | "unsupported-const-type"
  | "unsupported-declaration";

export type RejectedPackageExternBindingPlan = Readonly<{
  disposition: "unsupported";
  moduleSpecifier: string;
  runtimeExportName: string;
  localReference: string;
  source: PackageExternSource;
  reason: PackageExternRejectionReason;
}>;

export type PackageExternBindingPlan =
  | SupportedPackageExternBindingPlan
  | RejectedPackageExternBindingPlan;

/** Checker inputs are consumed immediately and never survive in the immutable plan. */
export type PackageExternBindingInput = Readonly<{
  checker: ts.TypeChecker;
  projectDir: string;
  moduleSpecifier: string;
  runtimeExportName: string;
  localReference: string;
  symbol: ts.Symbol | undefined;
  source: PackageExternSource;
}>;

type AliasResolution =
  | Readonly<{ ok: true; symbol: ts.Symbol }>
  | Readonly<{ ok: false; reason: "missing-symbol" | "alias-cycle" }>;

function resolveAlias(checker: ts.TypeChecker, initial: ts.Symbol | undefined): AliasResolution {
  if (!initial) return { ok: false, reason: "missing-symbol" };
  let symbol = initial;
  const seen = new Set<ts.Symbol>();
  while ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    if (seen.has(symbol)) return { ok: false, reason: "alias-cycle" };
    seen.add(symbol);
    symbol = checker.getAliasedSymbol(symbol);
  }
  return { ok: true, symbol };
}

function declarationFor(symbol: ts.Symbol): ts.Declaration | undefined {
  return symbol.valueDeclaration ?? symbol.declarations?.[0];
}

function portableDeclarationFile(projectDir: string, declaration: ts.Declaration): string {
  return path.relative(projectDir, declaration.getSourceFile().fileName)
    .split(path.sep)
    .join("/");
}

function primitiveHaxeType(type: ts.Type): PackageExternHaxeType | null {
  // TypeScript 6 represents the primitive `boolean` as its true/false union
  // and adds the Boolean bit to that aggregate. Testing the exact numeric flag
  // would therefore reject `boolean`, while testing BooleanLike would also
  // accept the narrower literal types. Primitive bits preserve that boundary.
  if ((type.flags & ts.TypeFlags.Boolean) !== 0) return "Bool";
  if ((type.flags & ts.TypeFlags.Number) !== 0) return "Float";
  if ((type.flags & ts.TypeFlags.String) !== 0) return "String";
  if ((type.flags & ts.TypeFlags.Void) !== 0) return "Void";
  return null;
}

function reject(
  input: PackageExternBindingInput,
  reason: PackageExternRejectionReason
): RejectedPackageExternBindingPlan {
  return {
    disposition: "unsupported",
    moduleSpecifier: input.moduleSpecifier,
    runtimeExportName: input.runtimeExportName,
    localReference: input.localReference,
    source: input.source,
    reason
  };
}

function planFunction(
  input: PackageExternBindingInput,
  symbol: ts.Symbol,
  declaration: ts.Declaration,
  identity: PackageExternPlanIdentity
): PackageExternBindingPlan {
  const declarations = symbol.declarations ?? [declaration];
  if (!declarations.every(ts.isFunctionDeclaration)) {
    return reject(input, "merged-declaration");
  }

  const functionType = input.checker.getTypeOfSymbolAtLocation(symbol, declaration);
  const signatures = functionType.getCallSignatures();
  if (signatures.length > 1) return reject(input, "overloaded-function");
  const signature = signatures[0];
  if (!signature) return reject(input, "unsupported-declaration");
  if (declarations.length !== 1) return reject(input, "merged-declaration");
  if ((signature.typeParameters?.length ?? 0) > 0) return reject(input, "generic-function");
  if (signature.thisParameter) return reject(input, "explicit-this-parameter");

  const parameters: PackageExternParameterPlan[] = [];
  for (const [index, parameter] of signature.getParameters().entries()) {
    const parameterDeclaration = declarationFor(parameter);
    if (!parameterDeclaration || !ts.isParameter(parameterDeclaration)) {
      return reject(input, "unsupported-parameter-declaration");
    }
    if (
      parameterDeclaration.questionToken
      || parameterDeclaration.initializer
      || (parameter.flags & ts.SymbolFlags.Optional) !== 0
    ) {
      return reject(input, "optional-parameter");
    }
    if (parameterDeclaration.dotDotDotToken) return reject(input, "rest-parameter");

    const parameterType = primitiveHaxeType(
      input.checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration)
    );
    if (!parameterType || parameterType === "Void") {
      return reject(input, "unsupported-parameter-type");
    }
    parameters.push({ name: `arg${index}`, type: parameterType });
  }

  const returnType = primitiveHaxeType(input.checker.getReturnTypeOfSignature(signature));
  if (!returnType) return reject(input, "unsupported-return-type");
  return {
    ...identity,
    disposition: "supported",
    member: {
      kind: "function",
      parameters,
      returnType
    }
  };
}

/**
 * Builds a production-neutral plan for one imported package value.
 *
 * Why: runtime request order is already proven, but current package externs
 * widen every field to `Dynamic`. This shadow planner establishes the exact
 * subset that can be represented with ordinary typed Haxe before any emitter
 * is allowed to consume it.
 *
 * What: only one non-generic, non-overloaded function over primitive values or
 * one declaration-file `const` primitive is supported. Mutable bindings,
 * optional/rest/`this` parameters, named object types, unions, classes, enums,
 * callable objects, merged declarations, and implementation-source packages
 * receive a stable rejection reason.
 *
 * How: aliases are resolved with checker-owned symbol identity, but the output
 * contains only immutable strings, numbers, and closed unions. TypeScript text
 * is never parsed, package code is never executed, and no Haxe is emitted.
 * The existing package-bound diagnostic remains authoritative until a later
 * reviewed commit deliberately connects this plan to translation.
 */
export function planPackageExternBinding(
  input: PackageExternBindingInput
): PackageExternBindingPlan {
  const resolved = resolveAlias(input.checker, input.symbol);
  if (!resolved.ok) return reject(input, resolved.reason);
  const symbol = resolved.symbol;
  if ((symbol.flags & ts.SymbolFlags.Value) === 0) return reject(input, "type-only-symbol");

  const declaration = declarationFor(symbol);
  if (!declaration) return reject(input, "unsupported-declaration");
  if (!declaration.getSourceFile().isDeclarationFile) {
    return reject(input, "implementation-source");
  }

  const identity: PackageExternPlanIdentity = {
    moduleSpecifier: input.moduleSpecifier,
    runtimeExportName: input.runtimeExportName,
    localReference: input.localReference,
    declarationName: symbol.getName(),
    declarationFile: portableDeclarationFile(input.projectDir, declaration),
    source: input.source
  };

  if (ts.isFunctionDeclaration(declaration)) {
    return planFunction(input, symbol, declaration, identity);
  }
  if (ts.isVariableDeclaration(declaration)) {
    if (
      !ts.isVariableDeclarationList(declaration.parent)
      || (declaration.parent.flags & ts.NodeFlags.Const) === 0
    ) {
      return reject(input, "mutable-export");
    }
    const valueType = primitiveHaxeType(
      input.checker.getTypeOfSymbolAtLocation(symbol, declaration)
    );
    if (!valueType || valueType === "Void") return reject(input, "unsupported-const-type");
    return {
      ...identity,
      disposition: "supported",
      member: { kind: "readonly-value", valueType }
    };
  }
  return reject(input, "unsupported-declaration");
}
