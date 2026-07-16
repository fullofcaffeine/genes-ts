import { deepStrictEqual, ok } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const fixtureRoot = path.join(repoRoot, "tests/finally-completion");
const outputRoot = path.join(fixtureRoot, "out");

/** Runs one deterministic fixture command from the repository root. */
function run(command: string, args: ReadonlyArray<string>): void {
  execFileSync(command, [...args], { cwd: repoRoot, stdio: "inherit" });
}

/** Captures the complete non-empty transcript from one compiled profile. */
function transcript(relativeFile: string): string[] {
  const output = execFileSync(process.execPath, [path.join(repoRoot, relativeFile)], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return output.trim().split(/\r?\n/).filter((line) => line.length > 0);
}

/** Rejects weak target types in implementation code owned by this fixture. */
function assertStrongGeneratedTypeScript(relativeFile: string): string {
  const source = readFileSync(path.join(outputRoot, relativeFile), "utf8");
  ok(!/\bany\b/.test(source), `${relativeFile} contains generated any`);
  ok(!/\bunknown\b/.test(source), `${relativeFile} contains broad unknown`);
  return source;
}

rmSync(outputRoot, { recursive: true, force: true });
run("haxe", ["tests/finally-completion/build-standard.hxml"]);
run("haxe", ["tests/finally-completion/build-classic.hxml"]);
run("haxe", ["tests/finally-completion/build-ts.hxml"]);
runGeneratedTypeScriptMatrix("tests/finally-completion/tsconfig.generated.json");
runGeneratedTypeScriptMatrix("tests/finally-completion/tsconfig.consumer.json", {
  emit: false
});

const expectedTranscript = ["finally-completion:ok"];
deepStrictEqual(
  transcript("tests/finally-completion/out/standard/index.cjs"),
  expectedTranscript
);
deepStrictEqual(
  transcript("tests/finally-completion/out/classic/index.js"),
  expectedTranscript
);
deepStrictEqual(
  transcript("tests/finally-completion/out/ts/dist/index.js"),
  expectedTranscript
);

const helperHaxe = readFileSync(
  path.join(repoRoot, "src/genes/js/FinallyCompletion.hx"),
  "utf8"
);
ok(!helperHaxe.includes("js.Syntax.code"),
  "completion runner remains ordinary request-free Haxe");
ok(!helperHaxe.includes("Dynamic"),
  "completion runner does not erase its carrier type");
ok(!helperHaxe.includes("untyped"),
  "completion runner does not bypass Haxe typing");
ok(!/\bcast\b/.test(helperHaxe),
  "completion runner does not cast the protected thrown value");
deepStrictEqual(
  helperHaxe.match(/catch \(bodyError:Any\)/g),
  ["catch (bodyError:Any)"],
  "one documented Any catch owns the host-thrown-value boundary"
);

const expectedArtifacts = [
  "classic/genes/js/FinallyCompletion.js",
  "classic/genes/js/FinallyCompletion.d.ts",
  "classic/finallycompletion/Main.js",
  "classic/finallycompletion/Main.d.ts",
  "ts/src-gen/genes/js/FinallyCompletion.ts",
  "ts/src-gen/finallycompletion/Main.ts"
];
for (const artifact of expectedArtifacts)
  ok(existsSync(path.join(outputRoot, artifact)), `expected ${artifact}`);

const tsHelper = assertStrongGeneratedTypeScript(
  "ts/src-gen/genes/js/FinallyCompletion.ts"
);
const tsMain = assertStrongGeneratedTypeScript(
  "ts/src-gen/finallycompletion/Main.ts"
);
const classicHelperDeclaration = readFileSync(
  path.join(outputRoot, "classic/genes/js/FinallyCompletion.d.ts"),
  "utf8"
);
ok(!/\bany\b/.test(classicHelperDeclaration),
  "classic helper declaration keeps its generic carrier typed");
ok(!/\bunknown\b/.test(classicHelperDeclaration),
  "classic helper declaration has no broad unknown boundary");

ok(tsHelper.includes("export class FinallyCompletion"),
  "genes-ts exposes the intentional generic runtime helper");
ok(tsHelper.includes("bodyError"),
  "genes-ts preserves the narrow protected-error path");
ok(tsMain.includes("type Abrupt<"),
  "genes-ts retains the private carrier for local implementation typing");
ok(!tsMain.includes("export type Abrupt<"),
  "genes-ts does not expose the private compiler carrier");
ok(!readFileSync(
  path.join(outputRoot, "classic/finallycompletion/Main.d.ts"),
  "utf8"
).includes("Abrupt"),
"classic declarations omit the private compiler carrier");

process.stdout.write(
  "finally-completion:ok (standard + classic + genes-ts; TS 5/6/7)\n"
);
