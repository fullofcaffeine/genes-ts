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

function run(cmd: string, args: string[], cwd: string) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

function runCapture(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8" });
}

function requireMarker(output: string, marker: string, label: string): void {
  if (!output.includes(marker)) {
    throw new Error(`${label}: expected output to include ${JSON.stringify(marker)}.\n\nOutput:\n${output}`);
  }
}

type Match = {
  file: string;
  line: number;
  text: string;
};

function collectFiles(absDir: string, out: string[]): void {
  for (const entry of fs.readdirSync(absDir)) {
    const abs = path.join(absDir, entry);
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      collectFiles(abs, out);
      continue;
    }
    if (st.isFile() && path.extname(entry) === ".ts") out.push(abs);
  }
}

function assertNoUnsafeTypes(opts: { repoRoot: string; absDir: string; label: string }): void {
  const forbidden = [
    /\bas any\b/,
    /\bas unknown\b/,
    /:\s*any\b/,
    /:\s*unknown\b/,
    /<\s*any\b/,
    /<\s*unknown\b/
  ];

  const files: string[] = [];
  collectFiles(opts.absDir, files);

  const matches: Match[] = [];
  for (const absFile of files) {
    const relToRepo = path.relative(opts.repoRoot, absFile);
    const text = fs.readFileSync(absFile, "utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i] ?? "";
      if (forbidden.some((re) => re.test(lineText))) {
        matches.push({ file: relToRepo, line: i + 1, text: lineText });
        if (matches.length >= 50) break;
      }
    }
    if (matches.length >= 50) break;
  }

  if (matches.length > 0) {
    const details = matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join("\n");
    throw new Error(
      [
        `Generated TS typing policy violation (${opts.label}):`,
        "- Found `any`/`unknown` in user modules.",
        "- Fix the emitter or move the dynamic typing behind the runtime boundary.",
        "",
        details
      ].join("\n")
    );
  }
}

function main(): number {
  const toolRoot = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const haxeBin = resolveHaxeBin(toolRoot);

  const tscBin = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
  const fixtureDir = path.join(toolRoot, "fixtures", "roundtrip-fixture");
  const fixtureTsconfig = path.join(fixtureDir, "tsconfig.json");

  const marker = "ROUNDTRIP_OK";

  // 1) Run the original TS fixture (tsc -> node).
  const origDist = path.join(toolRoot, ".tmp", "roundtrip-fixture-orig-dist");
  rmrf(origDist);
  fs.mkdirSync(origDist, { recursive: true });
  run("node", [tscBin, "-p", fixtureTsconfig, "--outDir", origDist], repoRoot);
  const origOut = runCapture("node", [path.join(origDist, "index.js")], repoRoot);
  requireMarker(origOut, marker, "original fixture");

  // 2) TS -> Haxe via ts2hx.
  const haxeOutDir = path.join(toolRoot, ".tmp", "roundtrip-fixture-haxe");
  rmrf(haxeOutDir);
  fs.mkdirSync(haxeOutDir, { recursive: true });

  const loaded = loadProject(fixtureTsconfig);
  if (!loaded.ok) {
    process.stderr.write(`Failed to load fixture project: ${fixtureTsconfig}\n`);
    for (const d of loaded.diagnostics) process.stderr.write(`${d.messageText}\n`);
    return 1;
  }

  const basePackage = "ts2hx_roundtrip";
  emitProjectToHaxe({
    projectDir: loaded.projectDir,
    rootDir: loaded.rootDir,
    program: loaded.program,
    checker: loaded.checker,
    sourceFiles: loaded.sourceFiles,
    outDir: haxeOutDir,
    basePackage
  });

  // 3) Haxe -> TS via genes-ts.
  const tsOutDir = path.join(toolRoot, ".tmp", "roundtrip-fixture-ts-src");
  rmrf(tsOutDir);
  fs.mkdirSync(tsOutDir, { recursive: true });

  run(
    haxeBin,
    ["-lib", "genes-ts", "-cp", haxeOutDir, "-main", `${basePackage}.Main`, "-js", path.join(tsOutDir, "index.ts"), "-D", "genes.ts"],
    repoRoot
  );

  // 3.5) Guardrails: user modules should not devolve to `any`/`unknown`.
  const userModulesDir = path.join(tsOutDir, basePackage);
  assertNoUnsafeTypes({ repoRoot, absDir: userModulesDir, label: basePackage });

  // 4) Typecheck + execute the roundtripped TS.
  const roundtripTsconfig = path.join(toolRoot, ".tmp", "roundtrip-fixture-tsconfig.json");
  fs.writeFileSync(
    roundtripTsconfig,
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmitOnError: true,
          rootDir: tsOutDir,
          outDir: path.join(toolRoot, ".tmp", "roundtrip-fixture-ts-dist"),
          types: ["node"]
        },
        include: ["**/*.ts"]
      },
      null,
      2
    ) + "\n"
  );

  const roundtripDist = path.join(toolRoot, ".tmp", "roundtrip-fixture-ts-dist");
  rmrf(roundtripDist);
  fs.mkdirSync(roundtripDist, { recursive: true });

  run("node", [tscBin, "-p", roundtripTsconfig], repoRoot);
  const roundtripOut = runCapture("node", [path.join(roundtripDist, "index.js")], repoRoot);
  requireMarker(roundtripOut, marker, "roundtripped output");

  process.stdout.write("Roundtrip OK\n");
  return 0;
}

process.exitCode = main();
