import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { emitProjectToHaxe, type TranslationMode } from "./haxe/emit.js";
import { loadProject } from "./project.js";
import { runTypeScriptApiBridge } from "./toolchains.js";

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
  genesTsRoundtrip?: boolean;
  requireStrongGeneratedHaxe?: boolean;
  translationMode?: TranslationMode;
  expectedUnsupportedFiles?: string[];
};

function assertStrongGeneratedHaxe(absDir: string, fixtureName: string): void {
  const forbidden = /\b(?:Dynamic|untyped|Unknown)\b|js\.Syntax|\bcast\b/;
  for (const rel of walkFiles(absDir).filter((file) => file.endsWith(".hx"))) {
    const text = fs.readFileSync(path.join(absDir, rel), "utf8");
    const match = text.split(/\r?\n/).findIndex((line) => forbidden.test(line));
    if (match >= 0)
      throw new Error(`${fixtureName}: weak generated Haxe at ${rel}:${match + 1}`);
  }
}

function assertStrongGeneratedTypeScript(absDir: string, fixtureName: string): void {
  const forbidden = /\bas (?:any|unknown)\b|:\s*(?:any|unknown)\b|<\s*(?:any|unknown)\b/;
  for (const rel of walkFiles(absDir).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))) {
    const text = fs.readFileSync(path.join(absDir, rel), "utf8");
    const match = text.split(/\r?\n/).findIndex((line) => forbidden.test(line));
    if (match >= 0)
      throw new Error(`${fixtureName}: weak generated TypeScript at ${rel}:${match + 1}`);
  }
}

function main(): number {
  const toolRoot = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
  const repoRoot = path.resolve(toolRoot, "..", "..");
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
      name: "basic-tsx",
      tsconfigPath: path.join(toolRoot, "fixtures", "basic-tsx", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "basic-tsx"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main",
      // TSX lowering currently emits `genes.react.internal.Jsx.__jsx` marker calls which
      // are lowered by genes-ts when emitting TS/TSX, but have no runtime implementation
      // in classic `haxe -js` output. Compile-smoke only for now.
      smokeRun: false
    },
    {
      name: "react-types",
      tsconfigPath: path.join(toolRoot, "fixtures", "react-types", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "react-types"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main",
      // JSX markers are compile-time genes-ts IR and intentionally have no
      // classic JavaScript runtime implementation.
      smokeRun: false,
      genesTsRoundtrip: true,
      requireStrongGeneratedHaxe: true
    },
    {
      name: "roundtrip-fixture",
      tsconfigPath: path.join(toolRoot, "fixtures", "roundtrip-fixture", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "roundtrip-fixture"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main",
      translationMode: "assisted",
      expectedUnsupportedFiles: ["index.ts"]
    },
    {
      name: "roundtrip-advanced",
      tsconfigPath: path.join(toolRoot, "fixtures", "roundtrip-advanced", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "roundtrip-advanced"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main",
      translationMode: "assisted",
      expectedUnsupportedFiles: ["index.ts"]
    },
    {
      name: "module-regexp",
      tsconfigPath: path.join(toolRoot, "fixtures", "module-regexp", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "module-regexp"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main",
      translationMode: "assisted",
      expectedUnsupportedFiles: ["index.ts"]
    },
    {
      name: "module-syntax",
      tsconfigPath: path.join(toolRoot, "fixtures", "module-syntax", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "module-syntax"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main",
      translationMode: "assisted",
      expectedUnsupportedFiles: ["index.ts"]
    },
    {
      name: "type-literals",
      tsconfigPath: path.join(toolRoot, "fixtures", "type-literals", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "type-literals"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main",
      translationMode: "assisted",
      expectedUnsupportedFiles: ["index.ts"]
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
      name: "params-defaults-rest",
      tsconfigPath: path.join(toolRoot, "fixtures", "params-defaults-rest", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "params-defaults-rest"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main"
    },
    {
      name: "optional-chain-assignments",
      tsconfigPath: path.join(toolRoot, "fixtures", "optional-chain-assignments", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "optional-chain-assignments"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main"
    },
    {
      name: "real-world-v1",
      tsconfigPath: path.join(toolRoot, "fixtures", "real-world-v1", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "real-world-v1"),
      basePackage: "ts2hx",
      smokeMain: "ts2hx.Main"
    },
    {
      name: "async-await",
      tsconfigPath: path.join(toolRoot, "fixtures", "async-await", "tsconfig.json"),
      snapshotsDir: path.join(toolRoot, "tests_snapshots", "async-await"),
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

    const translation = emitProjectToHaxe({
      projectDir: loaded.projectDir,
      rootDir: loaded.rootDir,
      program: loaded.program,
      checker: loaded.checker,
      sourceFiles: loaded.sourceFiles,
      outDir,
      basePackage: fixture.basePackage,
      mode: fixture.translationMode ?? "strict-js",
      cleanOutDir: true
    });

    const expectedUnsupported = (fixture.expectedUnsupportedFiles ?? []).slice().sort();
    const actualUnsupported = translation.dispositions
      .filter((item) => item.status === "unsupported")
      .map((item) => item.sourceFile)
      .sort();
    if (JSON.stringify(actualUnsupported) !== JSON.stringify(expectedUnsupported)) {
      throw new Error(
        `${fixture.name}: unsupported-file inventory changed; expected ` +
        `${JSON.stringify(expectedUnsupported)}, got ${JSON.stringify(actualUnsupported)}`
      );
    }
    const expectedStatus = expectedUnsupported.length > 0 ? "assisted" : "success";
    if (translation.status !== expectedStatus)
      throw new Error(`${fixture.name}: expected ${expectedStatus} translation, got ${translation.status}.`);

    if (fixture.requireStrongGeneratedHaxe)
      assertStrongGeneratedHaxe(outDir, fixture.name);

    // The semantic manifest is asserted structurally by test-semantic-diff.
    // Keeping one copy per syntax fixture would duplicate a large global
    // support matrix and turn harmless provenance additions into snapshot churn.
    const generatedFiles = walkFiles(outDir)
      .filter((file) => file !== "ts2hx-manifest.json")
      .sort((a, b) => a.localeCompare(b));
    const snapshotFiles = walkFiles(fixture.snapshotsDir)
      .filter((file) => file !== "ts2hx-manifest.json")
      .sort((a, b) => a.localeCompare(b));
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
      // Smoke compile the generated Haxe output. We include the repo `src/` on the classpath so fixtures
      // can use genes-ts macros (e.g. async/await sugar) while still keeping ts2hx as a standalone tool.
      const genesSrc = path.resolve(toolRoot, "..", "..", "src");
      run(
        haxeBin,
        [
          "-cp",
          outDir,
          "-cp",
          genesSrc,
          "--macro",
          "genes.js.Async.enable()",
          "-main",
          fixture.smokeMain,
          "-js",
          path.join(distDir, "index.js")
        ],
        toolRoot
      );
      if (fixture.smokeRun !== false) run("node", [path.join(distDir, "index.js")], toolRoot);
    }

    if (fixture.genesTsRoundtrip && fixture.smokeMain) {
      const tsxDir = path.join(toolRoot, ".tmp", `${fixture.name}-genes-ts`);
      rmrf(tsxDir);
      fs.mkdirSync(tsxDir, { recursive: true });
      run(
        haxeBin,
        [
          "-lib",
          "genes-ts",
          "-cp",
          outDir,
          "-main",
          fixture.smokeMain,
          "-js",
          path.join(tsxDir, "index.tsx"),
          "-D",
          "genes.ts"
        ],
        repoRoot
      );
      const roundtripConfig = path.join(tsxDir, "tsconfig.json");
      fs.writeFileSync(
        roundtripConfig,
        `${JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "ES2022",
            moduleResolution: "Bundler",
            strict: true,
            noEmit: true,
            jsx: "react-jsx",
            types: ["node", "react", "react-dom"]
          },
          include: ["**/*.tsx"]
        }, null, 2)}\n`
      );
      runTypeScriptApiBridge(repoRoot, ["-p", roundtripConfig]);
      assertStrongGeneratedTypeScript(path.join(tsxDir, fixture.basePackage), fixture.name);
    }
  }

  if (!update) process.stdout.write(`Snapshots OK (${totalFiles} files)\n`);
  return 0;
}

process.exitCode = main();
