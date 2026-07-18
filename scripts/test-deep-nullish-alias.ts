import { deepStrictEqual, ok } from "node:assert";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const fixtureRoot = path.join(repoRoot, "tests/deep-nullish-alias");

function run(
  command: string,
  args: ReadonlyArray<string>,
  options: ExecFileSyncOptions = {}
): void {
  execFileSync(command, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...options
  });
}

function runtimeTranscript(relativeFile: string): unknown {
  const output = execFileSync("node", [relativeFile], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  const line = output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .at(-1);
  if (line === undefined) {
    throw new Error(`${relativeFile} produced no runtime transcript`);
  }
  return JSON.parse(line) as unknown;
}

/**
 * Checks that the generated public API still says exactly what values it accepts.
 *
 * The external TypeScript programs already try valid and invalid calls. This
 * additional source check makes failures easier to understand: neither the
 * TypeScript implementation nor the classic declaration file may replace the
 * long aliases with vague `any` or `unknown` types, and both must retain the
 * three intended final types.
 */
function assertStrongSurface(relativeFile: string): void {
  const source = readFileSync(path.join(repoRoot, relativeFile), "utf8");
  ok(!/\b(?:any|unknown)\b/.test(source), `${relativeFile} contains a weak type`);
  ok(
    source.includes("export type DeepLink66<T> = DeepLink65<T>"),
    `${relativeFile} did not preserve the complete public alias chain`
  );
  ok(
    source.includes("export type DeepPlain = DeepLink66<string>"),
    `${relativeFile} widened the plain terminal type`
  );
  ok(
    source.includes("export type DeepNullable = DeepLink66<string | null>"),
    `${relativeFile} widened the nullable terminal type`
  );
  ok(
    source.includes(
      "export type DeepUndefinable = DeepLink66<string | undefined>"
    ),
    `${relativeFile} widened the undefined-aware terminal type`
  );
  ok(source.includes("plain: DeepPlain"), `${relativeFile} lost the plain field`);
  ok(
    source.includes("nullable: DeepNullable"),
    `${relativeFile} lost the nullable field`
  );
  ok(
    source.includes("undefinable: DeepUndefinable"),
    `${relativeFile} lost the undefined-aware field`
  );
}

rmSync(path.join(fixtureRoot, "out"), { recursive: true, force: true });

run("haxe", ["tests/deep-nullish-alias/build-standard.hxml"]);
run("haxe", ["tests/deep-nullish-alias/build-classic.hxml"]);
run("haxe", ["tests/deep-nullish-alias/build-ts.hxml"]);

runGeneratedTypeScriptMatrix("tests/deep-nullish-alias/tsconfig.generated.json");
runGeneratedTypeScriptMatrix(
  "tests/deep-nullish-alias/tsconfig.consumer-ts.json",
  { emit: false }
);
runGeneratedTypeScriptMatrix(
  "tests/deep-nullish-alias/tsconfig.consumer-classic.json",
  { emit: false }
);

assertStrongSurface(
  "tests/deep-nullish-alias/out/ts/src-gen/deepnullish/DeepNullishAliases.ts"
);
assertStrongSurface(
  "tests/deep-nullish-alias/out/classic/deepnullish/DeepNullishAliases.d.ts"
);

const expected = [
  "shape:plain:true:true",
  "plain-map:mapped:true",
  "nullable-map:true:true",
  "undefinable-map:true:false:true"
];
for (const relativeFile of [
  "tests/deep-nullish-alias/out/standard/index.cjs",
  "tests/deep-nullish-alias/out/classic/index.js",
  "tests/deep-nullish-alias/out/ts/dist/index.js"
]) {
  deepStrictEqual(runtimeTranscript(relativeFile), expected, relativeFile);
}

console.log(
  "deep-nullish-alias:ok (66 aliases; fields/parameters/returns/map reads; standard + classic + genes-ts TS5/6/7)"
);
