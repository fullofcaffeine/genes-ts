import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertNoUnsafeTypes } from "./typing-policy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function rmrf(relPath: string): void {
  rmSync(path.join(repoRoot, relPath), { recursive: true, force: true });
}

function run(cmd: string, args: ReadonlyArray<string>, opts: ExecFileSyncOptions = {}): void {
  execFileSync(cmd, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...opts
  });
}

function assertNoHelperBaseAny(relDir: string): void {
  const absDir = path.join(repoRoot, relDir);
  const offenders: string[] = [];
  function visit(dir: string): void {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        visit(full);
      } else if (name.endsWith(".d.ts")) {
        const source = readFileSync(full, "utf8");
        if (/^declare const \w+_base: any;$/m.test(source)) {
          offenders.push(path.relative(absDir, full));
        }
      }
    }
  }
  visit(absDir);
  if (offenders.length > 0) {
    throw new Error(`declaration helper bases must not expose any: ${offenders.join(", ")}`);
  }
}

function assertStdTypesCanMergeAcrossGeneratedPackages(): void {
  const relDir = "tests/genes-ts/snapshot/basic/out/stdtypes-package-merge";
  const absDir = path.join(repoRoot, relDir);
  rmrf(relDir);
  mkdirSync(path.join(absDir, "package-a"), { recursive: true });
  mkdirSync(path.join(absDir, "package-b"), { recursive: true });

  const stdTypesDts = readFileSync(
    path.join(repoRoot, "tests/genes-ts/snapshot/basic/out/dist/StdTypes.d.ts"),
    "utf8"
  );
  writeFileSync(path.join(absDir, "package-a", "StdTypes.d.ts"), stdTypesDts);
  writeFileSync(path.join(absDir, "package-b", "StdTypes.d.ts"), stdTypesDts);
  writeFileSync(
    path.join(absDir, "consumer.ts"),
    [
      'import "./package-a/StdTypes.js";',
      'import "./package-b/StdTypes.js";',
      "void PositionError;",
      "void FetchObserver;",
      ""
    ].join("\n")
  );

  run("npx", [
    "-y",
    "--package",
    "typescript@5.5.4",
    "-c",
    `tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noEmit --skipLibCheck false --typeRoots ${relDir}/empty ${relDir}/consumer.ts`
  ]);
}

rmrf("tests/genes-ts/snapshot/basic/out");

run("haxe", ["tests/genes-ts/snapshot/basic/build.hxml"]);
cpSync(
  path.join(repoRoot, "tests/genes-ts/snapshot/basic/src/resources"),
  path.join(repoRoot, "tests/genes-ts/snapshot/basic/out/src-gen/resources"),
  { recursive: true }
);
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "tests/genes-ts/snapshot/basic/out/src-gen",
  fileExts: [".ts"],
  ignoreTopLevelDirs: ["genes", "haxe", "js", "tink"],
  allowUnsafeTypeFiles: [
    // Dedicated boundary fixture proving genes.ts.Unknown emits TS `unknown`.
    "foo/BoundaryTypes.ts"
  ]
});

// Use a pinned TypeScript version for consistent behavior.
// Note: `npx typescript@X tsc -p ...` is ambiguous in some npm versions.
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests/genes-ts/snapshot/basic/tsconfig.json"
]);
assertNoHelperBaseAny("tests/genes-ts/snapshot/basic/out/dist");
assertStdTypesCanMergeAcrossGeneratedPackages();
const basicFooDts = readFileSync(
  path.join(repoRoot, "tests/genes-ts/snapshot/basic/out/dist/foo/Foo.d.ts"),
  "utf8"
);
if (!basicFooDts.includes("withPrivateOffset")) {
  throw new Error("private instance helpers should remain class-shaped while static helper lowering is enabled");
}
for (const privateName of ["privateNormalize"]) {
  if (basicFooDts.includes(privateName)) {
    throw new Error(`private Haxe helper leaked into generated declarations: ${privateName}`);
  }
}

run("node", ["tests/genes-ts/snapshot/basic/out/dist/index.js"]);
run("node", ["tests/genes-ts/repros/computed-native-member-call/check.mjs"]);
run("node", ["tests/genes-ts/repros/discriminated-unions/check.mjs"]);

rmrf("tests/genes-ts/snapshot/resource-imports/out");
run("haxe", ["tests/genes-ts/snapshot/resource-imports/build.hxml"]);
cpSync(
  path.join(repoRoot, "tests/genes-ts/snapshot/resource-imports/src/resources"),
  path.join(repoRoot, "tests/genes-ts/snapshot/resource-imports/out/src-gen/resources"),
  { recursive: true }
);
assertNoUnsafeTypes({
  repoRoot,
  generatedDir: "tests/genes-ts/snapshot/resource-imports/out/src-gen",
  fileExts: [".ts"],
  ignoreTopLevelDirs: ["genes", "haxe", "js", "tink"],
  allowUnsafeTypeFiles: []
});
run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests/genes-ts/snapshot/resource-imports/tsconfig.json"
]);

rmrf("tests/genes-ts/no-js-es/out");
run("haxe", ["tests/genes-ts/no-js-es/build.hxml"]);

const noJsEsMain = readFileSync(
  path.join(repoRoot, "tests/genes-ts/no-js-es/out/src-gen/Main.ts"),
  "utf8"
);
if (!noJsEsMain.includes("let value: string") || noJsEsMain.includes("var value: string")) {
  throw new Error("genes.ts mode must emit block-scoped `let` locals without relying on js-es=6");
}
if (!/\bvar value_1:/.test(noJsEsMain)) {
  throw new Error("inline-expanded same-named locals must be suffixed after the first emitted local");
}
const inlineValueNames = [...noJsEsMain.matchAll(/\bvar (value(?:_\d+)?):/g)].map(
  match => match[1]
);
if (inlineValueNames.filter(name => name === "value").length > 1) {
  throw new Error("inline-expanded same-named locals must not emit duplicate function-scoped `var value` declarations");
}
const mapFacadeBlock = noJsEsMain.match(/\bstatic buildMapHolder\(names: string\[\]\): MapHolder \{[\s\S]*?\n\t\}/)?.[0] ?? "";
if (!mapFacadeBlock.includes("named.set(name, Main.namedItem(name))") || !mapFacadeBlock.includes("ranked.set(\"first\", Main.rankedItem(1))")) {
  throw new Error("map facade fixture must emit public set calls");
}
if (mapFacadeBlock.includes(".inst.")) {
  throw new Error("map facade fixture must not expose backing `.inst` access in user modules");
}
const mapGetContinueBlock = noJsEsMain.match(/\bstatic mapGetAfterContinue\(ids: string\[\]\): string\[\] \{[\s\S]*?\n\t\}/)?.[0] ?? "";
if (!mapGetContinueBlock.includes("if (item == null)") || !mapGetContinueBlock.includes("continue;")) {
  throw new Error("map get narrowing fixture must keep an exiting null guard");
}
if (mapGetContinueBlock.includes("Register.unsafeCast") || mapGetContinueBlock.includes("item!")) {
  throw new Error("null-guarded map get locals should flow without unsafe casts or non-null assertions");
}
const mapGetExistsBlock = noJsEsMain.match(/\bstatic mapGetAfterExists\(id: string\): string \{[\s\S]*?\n\t\}/)?.[0] ?? "";
if (!mapGetExistsBlock.includes("named.exists(id)") || !mapGetExistsBlock.includes("named.get(id)!.name")) {
  throw new Error("map exists/get fixture must keep the public map facade calls");
}
if (mapGetExistsBlock.includes("Register.unsafeCast")) {
  throw new Error("Map.exists(key) should avoid unsafe casts for a following Map.get(key)");
}
const mapGetKeysBlock = noJsEsMain.match(/\bstatic mapGetAfterKeyIteration\(\): string\[\] \{[\s\S]*?\n\t\}/)?.[0] ?? "";
if (!mapGetKeysBlock.includes("named.keys()") || !/named\.get\(id\d*\)!\.name/.test(mapGetKeysBlock)) {
  throw new Error("map key-iteration fixture must keep keys/get facade calls");
}
if (mapGetKeysBlock.includes("Register.unsafeCast")) {
  throw new Error("keys yielded from Map.keys() should avoid unsafe casts for same-map Map.get(key)");
}
const directExistsBlock = noJsEsMain.match(/\bstatic mapGetDirectAfterExists\(id: string\): NamedItem \{[\s\S]*?\n\t\}/)?.[0] ?? "";
if (!directExistsBlock.includes("named.exists(id)") || !directExistsBlock.includes("return holder.named.get(id)!")) {
  throw new Error("direct Map.get after Map.exists should emit a TS non-null assertion");
}
if (directExistsBlock.includes("Register.unsafeCast")) {
  throw new Error("direct Map.get after Map.exists should not use unsafe casts");
}
const directKeysBlock = noJsEsMain.match(/\bstatic mapGetDirectAfterKeyIteration\(\): string\[\] \{[\s\S]*?\n\t\}/)?.[0] ?? "";
if (!directKeysBlock.includes("named.keys()") || !/formatNamedItem\(holder\.named\.get\(id\d*\)!\)/.test(directKeysBlock)) {
  throw new Error("direct Map.get during key iteration should emit a TS non-null assertion");
}
if (directKeysBlock.includes("Register.unsafeCast")) {
  throw new Error("direct Map.get during key iteration should not use unsafe casts");
}
const closureGuardBlock = noJsEsMain.match(/\bstatic closureAfterOuterGuard\(id: string\): NamedCallback \| null \{[\s\S]*?\n\t\}/)?.[0] ?? "";
if (!closureGuardBlock.includes("(item!).name")) {
  throw new Error("outer null guards must not erase receiver assertions inside returned closures");
}
if (!/\bmapAfterResultParameter\(result: MessageBatch\): number\[\] \{[\s\S]*\bvar result_1: number\[\]/.test(noJsEsMain)) {
  throw new Error("array-map helper temporaries must be suffixed when an enclosing parameter is named `result`");
}
if (/\bmapAfterResultParameter\(result: MessageBatch\): number\[\] \{[\s\S]*\bvar result: number\[\]/.test(noJsEsMain)) {
  throw new Error("array-map helper temporaries must not redeclare a `result` parameter");
}
const loweredRecordBlock = noJsEsMain.match(/\bstatic loweredRecordConstructionTemps\(id: string\): string \{[\s\S]*?\n\t\}/)?.[0] ?? "";
if (!loweredRecordBlock.includes("var name: string") || !loweredRecordBlock.includes("var family: string") || !loweredRecordBlock.includes("var flags: RecordFlags")) {
  throw new Error("lowered record construction temps should use object field names");
}
if (/\bvar parsed\d+:/.test(loweredRecordBlock)) {
  throw new Error("single-use lowered record field temps should not keep parsedN names");
}
if (!/\bvar parsed: LargeRecord =/.test(loweredRecordBlock)) {
  throw new Error("final lowered record object should recover the shared base name");
}

run("npx", [
  "-y",
  "--package",
  "typescript@5.5.4",
  "-c",
  "tsc -p tests/genes-ts/no-js-es/tsconfig.json"
]);
