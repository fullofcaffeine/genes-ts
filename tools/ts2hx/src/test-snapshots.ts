import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { emitProjectToHaxe } from "./haxe/emit.js";
import { loadProject } from "./project.js";

function resolveHaxeBin(toolRoot: string): string {
  const env = process.env.HAXE_BIN;
  if (typeof env === "string" && env.length > 0) return env;

  const localBin = path.resolve(
    toolRoot,
    "..",
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "haxe.cmd" : "haxe"
  );
  if (fs.existsSync(localBin)) return localBin;

  return "haxe";
}

function rmrf(absPath: string): void {
  if (!fs.existsSync(absPath)) return;
  const stat = fs.lstatSync(absPath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absPath)) rmrf(path.join(absPath, entry));
    fs.rmdirSync(absPath);
  } else {
    fs.unlinkSync(absPath);
  }
}

function walkFiles(absDir: string, relBase = ""): string[] {
  const results: string[] = [];
  if (!fs.existsSync(absDir)) return results;
  for (const entry of fs.readdirSync(absDir)) {
    const abs = path.join(absDir, entry);
    const rel = path.join(relBase, entry);
    const stat = fs.lstatSync(abs);
    if (stat.isDirectory()) results.push(...walkFiles(abs, rel));
    else results.push(rel);
  }
  return results;
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function run(cmd: string, args: string[], cwd: string) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

type Fixture = {
  name: string;
  tsconfigPath: string;
  snapshotsDir: string;
  basePackage: string;
  smokeMain: string | null;
  smokeRun?: boolean;
};

function main(): number {
  const toolRoot = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
  const haxeBin = resolveHaxeBin(toolRoot);
  const update = process.env.UPDATE_SNAPSHOTS === "1";

  const fixtures: Fixture[] = [
    {
      name: "minimal-codegen",
      tsconfigPath: path.join(toolRoot, "fixtures", "minimal-codegen", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "minimal-codegen"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main"
    },
    {
      name: "classes-enums",
      tsconfigPath: path.join(toolRoot, "fixtures", "classes-enums", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "classes-enums"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main"
    },
    {
      name: "roundtrip-fixture",
      tsconfigPath: path.join(toolRoot, "fixtures", "roundtrip-fixture", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "roundtrip-fixture"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main"
    },
    {
      name: "roundtrip-advanced",
      tsconfigPath: path.join(toolRoot, "fixtures", "roundtrip-advanced", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "roundtrip-advanced"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main"
    },
    {
      name: "module-syntax",
      tsconfigPath: path.join(toolRoot, "fixtures", "module-syntax", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "module-syntax"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main"
    },
    {
      name: "type-literals",
      tsconfigPath: path.join(toolRoot, "fixtures", "type-literals", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "type-literals"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main"
    },
    {
      name: "export-forms",
      tsconfigPath: path.join(toolRoot, "fixtures", "export-forms", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "export-forms"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main"
    },
    {
      name: "statement-coverage",
      tsconfigPath: path.join(toolRoot, "fixtures", "statement-coverage", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "statement-coverage"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main"
    },
    {
      name: "expression-coverage",
      tsconfigPath: path.join(toolRoot, "fixtures", "expression-coverage", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "expression-coverage"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main"
    },
    {
      name: "type-emission",
      tsconfigPath: path.join(toolRoot, "fixtures", "type-emission", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "type-emission"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main"
    },
    {
      name: "object-methods-spreads",
      tsconfigPath: path.join(toolRoot, "fixtures", "object-methods-spreads", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "object-methods-spreads"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main"
    },
    {
      name: "destructuring",
      tsconfigPath: path.join(toolRoot, "fixtures", "destructuring", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "destructuring"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main"
    },
    {
      name: "non-relative-imports",
      tsconfigPath: path.join(toolRoot, "fixtures", "non-relative-imports", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "non-relative-imports"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main",
      // Haxe's JS output for `@:jsRequire` uses CommonJS `require()`. The ts2hx tool package is ESM (`type: "module"`),
      // so `node dist/index.js` would fail at runtime for this fixture. We still compile the emitted Haxe as a smoke test.
      smokeRun: false
    }
  ];

  let totalFiles = 0;

  for (const fixture of fixtures) {
    const outDir = path.join(toolRoot, ".tmp", `${fixture.name}-out`);
    const distDir = path.join(toolRoot, ".tmp", `${fixture.name}-dist`);

    rmrf(outDir);
    fs.mkdirSync(outDir, { recursive: true });

    const loaded = loadProject(fixture.tsconfigPath);
    if (!loaded.ok) {
      process.stderr.write(`Failed to load fixture project: ${fixture.tsconfigPath}\n`);
      for (const d of loaded.diagnostics) process.stderr.write(`${d.messageText}\n`);
      return 1;
    }

    emitProjectToHaxe({
      projectDir: loaded.projectDir,
      rootDir: loaded.rootDir,
      program: loaded.program,
      checker: loaded.checker,
      sourceFiles: loaded.sourceFiles,
      outDir,
      basePackage: fixture.basePackage
    });

    const generatedFiles = walkFiles(outDir).sort((a, b) => a.localeCompare(b));
    const snapshotFiles = walkFiles(fixture.snapshotsDir).sort((a, b) => a.localeCompare(b));
    totalFiles += generatedFiles.length;

    if (update) {
      rmrf(fixture.snapshotsDir);
      fs.mkdirSync(fixture.snapshotsDir, { recursive: true });
      for (const rel of generatedFiles) {
        const absSrc = path.join(outDir, rel);
        const absDest = path.join(fixture.snapshotsDir, rel);
        fs.mkdirSync(path.dirname(absDest), { recursive: true });
        fs.copyFileSync(absSrc, absDest);
      }
      process.stdout.write(`Updated snapshots in ${fixture.snapshotsDir}\n`);
    } else {
      const missingSnapshots = generatedFiles.filter((rel) => !fs.existsSync(path.join(fixture.snapshotsDir, rel)));
      const extraSnapshots = snapshotFiles.filter((rel) => !fs.existsSync(path.join(outDir, rel)));

      if (missingSnapshots.length > 0) {
        process.stderr.write(
          `Missing snapshot files for ${fixture.name}:\n${missingSnapshots.map((p) => `  ${p}`).join("\n")}\n`
        );
        return 1;
      }

      if (extraSnapshots.length > 0) {
        process.stderr.write(
          `Extra snapshot files for ${fixture.name} (stale):\n${extraSnapshots.map((p) => `  ${p}`).join("\n")}\n`
        );
        return 1;
      }

      for (const rel of generatedFiles) {
        const absGen = path.join(outDir, rel);
        const absSnap = path.join(fixture.snapshotsDir, rel);
        const gen = normalize(fs.readFileSync(absGen, "utf8"));
        const snap = normalize(fs.readFileSync(absSnap, "utf8"));
        if (gen !== snap) {
          process.stderr.write(`Snapshot mismatch (${fixture.name}): ${rel}\n`);
          return 1;
        }
      }
    }

    if (fixture.smokeMain) {
      rmrf(distDir);
      fs.mkdirSync(distDir, { recursive: true });
      run(haxeBin, ["-cp", outDir, "-main", fixture.smokeMain, "-js", path.join(distDir, "index.js")], toolRoot);
      if (fixture.smokeRun !== false) run("node", [path.join(distDir, "index.js")], toolRoot);
    }
  }

  if (!update) process.stdout.write(`Snapshots OK (${totalFiles} files)\n`);
  return 0;
}

process.exitCode = main();
