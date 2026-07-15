import { ok, strictEqual } from "node:assert";
import {
  execFileSync,
  spawnSync,
  type ExecFileSyncOptions
} from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertExportedSurfacePolicy } from "./exported-surface-policy.js";
import { runGeneratedTypeScriptMatrix } from "./toolchains.js";

/**
 * Proves the reusable-library profile as one dual-output compiler contract.
 *
 * Why: a declaration-only test can accidentally promise DCE-stripped methods,
 * while a runtime-only test cannot detect missing or widened public types. The
 * profile must also remain opt-in so application output does not silently grow.
 *
 * What: one inert Haxe source tree is built as default classic output, library
 * classic JS plus `.d.ts`, and genes-ts implementation source. The gate checks
 * default absence, matched public shapes, negative consumer typing, generic
 * abstract ownership, and execution of both retained implementations.
 *
 * How: every build starts from an empty output directory. An invalid classic
 * configuration must fail before opening an output writer. The valid profiles
 * then run through all pinned TypeScript lanes and Node, so snapshots alone can
 * never establish this contract.
 */

const scriptFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptFile), "../..");
const fixtureRoot = path.join(repoRoot, "tests/library-profile");

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

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function absent(relativePath: string): void {
  ok(!existsSync(path.join(repoRoot, relativePath)), `${relativePath} must be absent`);
}

rmSync(path.join(fixtureRoot, "out"), { recursive: true, force: true });

const invalid = spawnSync("haxe", ["tests/library-profile/build-invalid.hxml"], {
  cwd: repoRoot,
  encoding: "utf8"
});
strictEqual(invalid.status, 1, "classic genes.library without dts must fail");
ok(
  `${invalid.stdout}${invalid.stderr}`.includes(
    "-D genes.library requires -D dts in classic output"
  ),
  "invalid profile must explain the matched-surface requirement"
);
absent("tests/library-profile/out/invalid/index.js");

const missingRoot = spawnSync(
  "haxe",
  ["tests/library-profile/build-missing-root.hxml"],
  { cwd: repoRoot, encoding: "utf8" }
);
strictEqual(missingRoot.status, 1, "a library profile without typed roots must fail");
ok(
  `${missingRoot.stdout}${missingRoot.stderr}`.includes(
    "-D genes.library found no typed @:genes.library class"
  ),
  "missing roots must explain how to type otherwise-unreferenced APIs"
);
absent("tests/library-profile/out/missing-root/index.js");

run("haxe", ["tests/library-profile/build-default.hxml"]);
absent("tests/library-profile/out/default/index.d.ts");
absent("tests/library-profile/out/default/library_profile/LibraryApi.js");
absent("tests/library-profile/out/default/library_profile/LibraryApi.d.ts");
absent("tests/library-profile/out/default/library_profile/SignatureOnly.js");
absent("tests/library-profile/out/default/library_profile/SignatureOnly.d.ts");
ok(
  !read("tests/library-profile/out/default/index.js").includes("LibraryApi"),
  "the inactive marker must not create a package export"
);

run("haxe", ["tests/library-profile/build-library.hxml"]);
const classicRoot = read("tests/library-profile/out/library/index.js");
const libraryJs = read(
  "tests/library-profile/out/library/library_profile/LibraryApi.js"
);
const libraryDts = read(
  "tests/library-profile/out/library/library_profile/LibraryApi.d.ts"
);
const signatureJs = read(
  "tests/library-profile/out/library/library_profile/SignatureOnly.js"
);
const signatureDts = read(
  "tests/library-profile/out/library/library_profile/SignatureOnly.d.ts"
);
const abstractDts = read(
  "tests/library-profile/out/library/library_profile/GenericView.d.ts"
);

ok(
  classicRoot.includes(
    'export {LibraryApi} from "./library_profile/LibraryApi.js"'
  ),
  "library root must receive a deterministic ESM re-export"
);
for (const member of ["roundTrip", "first"]) {
  ok(libraryJs.includes(`${member}(`), `classic JS lost LibraryApi.${member}`);
  ok(libraryDts.includes(`${member}`), `classic declarations lost LibraryApi.${member}`);
}
ok(!libraryJs.includes("implementationDetail"));
ok(!libraryDts.includes("implementationDetail"));
ok(signatureJs.includes("upper()"));
ok(signatureDts.includes("upper(): string"));
ok(!signatureJs.includes("secret()"));
ok(!signatureDts.includes("secret()"));
ok(
  abstractDts.includes("static first<T>($this: T[]): T | null"),
  "abstract receiver helper must own its generic parameter"
);
ok(
  abstractDts.includes("static version(): string"),
  "true abstract static must remain non-generic"
);
ok(
  !abstractDts.includes("static version<T>"),
  "abstract owner generics must not leak onto true statics"
);

assertExportedSurfacePolicy({
  repoRoot,
  tsconfigPath: "tests/library-profile/tsconfig.json",
  includePaths: [
    "tests/library-profile/out/library/library_profile/LibraryApi.d.ts",
    "tests/library-profile/out/library/library_profile/SignatureOnly.d.ts",
    "tests/library-profile/out/library/library_profile/GenericView.d.ts"
  ],
  scope: "library-profile-classic"
});
runGeneratedTypeScriptMatrix("tests/library-profile/tsconfig.json", {
  emit: false
});
run("node", ["tests/library-profile/runtime.mjs"]);

run("haxe", ["tests/library-profile/build-typescript.hxml"]);
const typescriptApi = read(
  "tests/library-profile/out/typescript/src-gen/library_profile/LibraryApi.ts"
);
const typescriptAbstract = read(
  "tests/library-profile/out/typescript/src-gen/library_profile/GenericView.ts"
);
ok(typescriptApi.includes("roundTrip(value: SignatureOnly): SignatureOnly"));
ok(typescriptApi.includes("first<T>(values: T[]): T | null"));
ok(
  /static first<T>\([^:]+: T\[\]\): T \| null/.test(typescriptAbstract),
  "TS abstract receiver helper must own its generic parameter"
);
ok(typescriptAbstract.includes("static version(): string"));
ok(!typescriptAbstract.includes("static version<T>"));
runGeneratedTypeScriptMatrix("tests/library-profile/tsconfig-typescript.json");
run("node", ["tests/library-profile/runtime-typescript.mjs"]);

console.log("library-profile: default, classic, declarations, and TS are green");
