import fs from "fs";
import path from "path";
import { emitProjectToHaxe, type EmitHaxeOptions } from "./haxe/emit.js";
import { loadProject } from "./project.js";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function resetDir(absDir: string): void {
  fs.rmSync(absDir, { recursive: true, force: true });
  fs.mkdirSync(absDir, { recursive: true });
}

function snapshotTree(absDir: string, relDir = ""): string[] {
  const current = path.join(absDir, relDir);
  if (!fs.existsSync(current)) return [];
  const result: string[] = [];
  for (const name of fs.readdirSync(current).sort((a, b) => a.localeCompare(b))) {
    const relative = path.join(relDir, name);
    const absolute = path.join(absDir, relative);
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) result.push(...snapshotTree(absDir, relative));
    else result.push(`${relative.split(path.sep).join("/")}:${fs.readFileSync(absolute).toString("base64")}`);
  }
  return result;
}

function loadFixture(projectDir: string): Extract<ReturnType<typeof loadProject>, { ok: true }> {
  const loaded = loadProject(path.join(projectDir, "tsconfig.json"));
  if (!loaded.ok)
    throw new Error(`Could not load output-ownership fixture: ${loaded.diagnostics.length} diagnostic(s).`);
  return loaded;
}

function optionsFor(
  project: Extract<ReturnType<typeof loadProject>, { ok: true }>,
  outDir: string
): EmitHaxeOptions {
  return {
    projectDir: project.projectDir,
    rootDir: project.rootDir,
    program: project.program,
    checker: project.checker,
    sourceFiles: project.sourceFiles,
    outDir,
    basePackage: "ownership_test",
    runtimeProfile: "standard-haxe-js",
    mode: "strict-js",
    cleanOutDir: false
  };
}

function expectOwnershipFailure(action: () => void, label: string): Error {
  try {
    action();
  } catch (error) {
    assert(error instanceof Error, `${label}: ownership failure was not an Error`);
    assert(error.message.includes("prior ts2hx ownership manifest"),
      `${label}: failure did not identify the ownership manifest: ${error.message}`);
    return error;
  }
  throw new Error(`${label}: malformed ownership manifest was accepted`);
}

/**
 * Proves that no-clean publication removes only files owned by the prior run.
 *
 * Why: overlaying a new translation on the whole old directory used to retain
 * Haxe for renamed or deleted TypeScript sources. That stale module could keep
 * compiling even though it no longer existed in the source project.
 *
 * What: a recognized prior `plannedFiles` inventory owns generated files. A
 * later no-clean run removes missing inventory entries, preserves every path
 * outside that inventory, and refuses malformed ownership data instead of
 * guessing from filenames or extensions.
 *
 * How: the fixture publishes two sources, removes one source, and republishes
 * into the same mixed directory. It also exercises missing, malformed, and
 * unsafe manifests so the transaction must establish ownership before it can
 * mutate the prior tree.
 */
function main(): void {
  const toolRoot = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
  const tmpRoot = path.join(toolRoot, ".tmp", "output-ownership");
  const projectDir = path.join(tmpRoot, "project");
  const sourceDir = path.join(projectDir, "src");
  const outDir = path.join(tmpRoot, "generated");
  resetDir(tmpRoot);
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      rootDir: "src",
      strict: true,
      skipLibCheck: true
    },
    include: ["src/**/*.ts"]
  }, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(sourceDir, "Main.ts"), "export const retained: number = 1;\n", "utf8");
  fs.writeFileSync(path.join(sourceDir, "Removed.ts"), "export const obsolete: number = 1;\n", "utf8");

  const first = emitProjectToHaxe(optionsFor(loadFixture(projectDir), outDir));
  assert(first.status === "success", `initial translation status was ${first.status}`);
  const removedOutput = path.join(outDir, "ownership_test", "Removed.hx");
  assert(fs.existsSync(removedOutput), "initial translation did not publish Removed.hx");
  assert(first.manifest.plannedFiles.includes("ownership_test/Removed.hx"),
    "initial manifest did not own Removed.hx");

  const userAsset = path.join(outDir, "user-owned.txt");
  const handwrittenHaxe = path.join(outDir, "handwritten", "Keep.hx");
  const colocatedAsset = path.join(outDir, "ownership_test", "notes.txt");
  fs.writeFileSync(userAsset, "keep-user-asset\n", "utf8");
  fs.mkdirSync(path.dirname(handwrittenHaxe), { recursive: true });
  fs.writeFileSync(handwrittenHaxe, "class Keep {}\n", "utf8");
  fs.writeFileSync(colocatedAsset, "keep-package-asset\n", "utf8");

  fs.rmSync(path.join(sourceDir, "Removed.ts"));
  fs.writeFileSync(path.join(sourceDir, "Main.ts"), "export const retained: number = 2;\n", "utf8");
  const second = emitProjectToHaxe(optionsFor(loadFixture(projectDir), outDir));
  assert(second.status === "success", `replacement translation status was ${second.status}`);
  assert(!fs.existsSync(removedOutput), "no-clean publication retained manifest-owned stale Removed.hx");
  assert(fs.readFileSync(userAsset, "utf8") === "keep-user-asset\n", "no-clean publication changed a user asset");
  assert(fs.readFileSync(handwrittenHaxe, "utf8") === "class Keep {}\n", "no-clean publication changed handwritten Haxe");
  assert(fs.readFileSync(colocatedAsset, "utf8") === "keep-package-asset\n",
    "stale cleanup changed an unowned file beside generated Haxe");
  assert(!second.manifest.plannedFiles.includes("ownership_test/Removed.hx"),
    "replacement manifest retained the removed source output");

  const stableTree = snapshotTree(outDir);
  const repeated = emitProjectToHaxe(optionsFor(loadFixture(projectDir), outDir));
  assert(repeated.status === "success", `repeated translation status was ${repeated.status}`);
  assert(JSON.stringify(snapshotTree(outDir)) === JSON.stringify(stableTree),
    "identical no-clean translations produced different trees");

  const manifestPath = path.join(outDir, "ts2hx-manifest.json");
  fs.writeFileSync(manifestPath, "{not valid json\n", "utf8");
  const malformedTree = snapshotTree(outDir);
  expectOwnershipFailure(
    () => emitProjectToHaxe(optionsFor(loadFixture(projectDir), outDir)),
    "malformed-json"
  );
  assert(JSON.stringify(snapshotTree(outDir)) === JSON.stringify(malformedTree),
    "malformed ownership manifest changed the prior tree");

  const casualty = path.join(tmpRoot, "outside-casualty.txt");
  fs.writeFileSync(casualty, "outside\n", "utf8");
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    ...second.manifest,
    plannedFiles: ["../outside-casualty.txt"]
  }, null, 2)}\n`, "utf8");
  const unsafeTree = snapshotTree(outDir);
  expectOwnershipFailure(
    () => emitProjectToHaxe(optionsFor(loadFixture(projectDir), outDir)),
    "unsafe-path"
  );
  assert(JSON.stringify(snapshotTree(outDir)) === JSON.stringify(unsafeTree),
    "unsafe ownership manifest changed the prior tree");
  assert(fs.readFileSync(casualty, "utf8") === "outside\n", "unsafe ownership path changed an outside file");

  const unownedOut = path.join(tmpRoot, "unowned");
  fs.mkdirSync(unownedOut, { recursive: true });
  const unownedHaxe = path.join(unownedOut, "Legacy.hx");
  fs.writeFileSync(unownedHaxe, "class Legacy {}\n", "utf8");
  const noManifest = emitProjectToHaxe(optionsFor(loadFixture(projectDir), unownedOut));
  assert(noManifest.status === "success", `no-manifest translation status was ${noManifest.status}`);
  assert(fs.readFileSync(unownedHaxe, "utf8") === "class Legacy {}\n",
    "no-clean publication inferred ownership from a Haxe filename");

  process.stdout.write("ts2hx-output-ownership:ok\n");
}

main();
