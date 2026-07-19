import { deepStrictEqual, ok } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixtureRoot = path.join(repoRoot, "tests/internal-types");
const outputRoot = path.join(fixtureRoot, "out");

/** Runs one deterministic fixture command from the repository root. */
function run(command: string, args: ReadonlyArray<string>): void {
  execFileSync(command, [...args], { cwd: repoRoot, stdio: "inherit" });
}

/** Captures the one-line transcript from one compiled profile. */
function transcript(relativeFile: string): string[] {
  const output = execFileSync(process.execPath, [path.join(repoRoot, relativeFile)], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return output.trim().split(/\r?\n/).filter((line) => line.length > 0);
}

/** Returns the one-based generated line containing an exact token. */
function generatedLine(source: string, token: string): number {
  const offset = source.indexOf(token);
  ok(offset !== -1, `generated source contains ${token}`);
  return source.slice(0, offset).split("\n").length;
}

/**
 * Proves an invented compiler type owns no generated mapping interval.
 *
 * The neighboring public declaration must still map normally, so suppressing
 * the internal type cannot disable source maps for the rest of its module.
 */
function assertInternalIntervalUnmapped(
  relativeSource: string,
  startToken: string,
  nextPublicToken: string
): void {
  const sourcePath = path.join(outputRoot, relativeSource);
  const source = readFileSync(sourcePath, "utf8");
  const startLine = generatedLine(source, startToken);
  const nextPublicLine = generatedLine(source, nextPublicToken);
  const map = new SourceMapConsumer(JSON.parse(
    readFileSync(`${sourcePath}.map`, "utf8")
  ) as RawSourceMap);
  const internalMappings: number[] = [];
  let publicMapped = false;
  map.eachMapping((mapping) => {
    if (mapping.generatedLine >= startLine
      && mapping.generatedLine < nextPublicLine) {
      internalMappings.push(mapping.generatedLine);
    }
    if (mapping.generatedLine === nextPublicLine && mapping.source != null)
      publicMapped = true;
  });
  deepStrictEqual(internalMappings, [],
    `${relativeSource} does not map its compiler-internal type`);
  ok(publicMapped, `${relativeSource} still maps the neighboring public type`);
}

rmSync(outputRoot, { recursive: true, force: true });
run("haxe", ["tests/internal-types/build-standard.hxml"]);
run("haxe", ["tests/internal-types/build-classic.hxml"]);
run("haxe", ["tests/internal-types/build-ts.hxml"]);

runGeneratedTypeScriptMatrix("tests/internal-types/tsconfig.generated.json");
runGeneratedTypeScriptMatrix("tests/internal-types/tsconfig.consumer.json", {
  emit: false
});

deepStrictEqual(transcript("tests/internal-types/out/standard/index.cjs"), ["typed"]);
deepStrictEqual(transcript("tests/internal-types/out/classic/index.js"), ["typed"]);
deepStrictEqual(transcript("tests/internal-types/out/ts/dist/index.js"), ["typed"]);

const classicPath = path.join(outputRoot, "classic/internaltypes/Main.js");
const tsPath = path.join(outputRoot, "ts/src-gen/internaltypes/Main.ts");
const declarationPath = path.join(outputRoot, "classic/internaltypes/Main.d.ts");
for (const required of [classicPath, tsPath, declarationPath])
  ok(existsSync(required), `expected generated artifact ${required}`);

const classic = readFileSync(classicPath, "utf8");
ok(classic.includes("const LocalTag = function() {}"),
  "classic keeps the existing private interface runtime marker");
ok(classic.includes("const LocalBox = Register.hxClasses()"),
  "ordinary private classes retain Haxe runtime registration");
ok(classic.includes('Register.hxEnums()["internaltypes._Main.LocalState"]'),
  "ordinary private enums retain Haxe runtime registration");
ok(classic.includes("const InternalResult ="),
  "classic keeps the compiler-internal enum implementation");
ok(!classic.includes("export const InternalResult"),
  "classic does not export the compiler-internal enum");
ok(!classic.includes('["internaltypes._Main.InternalResult"]'),
  "classic does not register the compiler-internal enum");
ok(classic.includes("export const PublicSibling"),
  "classic exports the public secondary module type");

const typescript = readFileSync(tsPath, "utf8");
for (const localDeclaration of [
  "declare namespace InternalResult",
  "type InternalResult<"
]) {
  ok(typescript.includes(localDeclaration),
    `genes-ts keeps ${localDeclaration} for local typing`);
  ok(!typescript.includes(`export ${localDeclaration}`),
    `genes-ts does not export ${localDeclaration}`);
}
ok(typescript.includes('Register.setHxClass("internaltypes._Main.LocalBox"'),
  "ordinary private classes retain genes-ts runtime registration");
ok(typescript.includes('Register.setHxEnum("internaltypes._Main.LocalState"'),
  "ordinary private enums retain genes-ts runtime registration");
ok(typescript.includes("type InternalRecord ="),
  "genes-ts keeps a compiler-internal typedef needed by local annotations");
ok(!typescript.includes("export type InternalRecord ="),
  "genes-ts does not export the compiler-internal typedef");
ok(!typescript.includes('Register.setHxEnum("internaltypes._Main.InternalResult"'),
  "genes-ts does not register the compiler-internal enum");
ok(typescript.includes("export declare namespace PublicSibling"),
  "genes-ts exports the public secondary module type");

const declaration = readFileSync(declarationPath, "utf8");
ok(!declaration.includes("InternalResult"),
  "classic declarations omit the compiler-internal type");
ok(!declaration.includes("InternalRecord"),
  "classic declarations omit the compiler-internal typedef");
ok(declaration.includes("export declare class Main"),
  "classic declarations retain the public neighboring type");
ok(declaration.includes("export declare type PublicSibling"),
  "classic declarations retain the public secondary module type");

assertInternalIntervalUnmapped(
  "classic/internaltypes/Main.js",
  "const InternalResult =",
  "export const Main ="
);
assertInternalIntervalUnmapped(
  "ts/src-gen/internaltypes/Main.ts",
  "type InternalRecord =",
  "export declare namespace LocalState"
);
assertInternalIntervalUnmapped(
  "ts/src-gen/internaltypes/Main.ts",
  "declare namespace InternalResult",
  "export class Main"
);

process.stdout.write(
  "internal-types:ok (standard + classic + genes-ts; private/internal projection contained)\n"
);
