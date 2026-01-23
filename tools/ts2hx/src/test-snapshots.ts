import fs from "fs";
import path from "path";
import { emitProjectToHaxe } from "./haxe/emit.js";
import { loadProject } from "./project.js";

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

function main(): number {
  const toolRoot = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
  const fixtureRoot = path.join(toolRoot, "fixtures", "minimal-codegen");
  const projectPath = path.join(fixtureRoot, "tsconfig.json");
  const outDir = path.join(toolRoot, ".tmp", "minimal-codegen-out");
  const snapshotsDir = path.join(toolRoot, "tests_snapshots", "minimal-codegen");

  rmrf(outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const loaded = loadProject(projectPath);
  if (!loaded.ok) {
    process.stderr.write(`Failed to load fixture project: ${projectPath}\n`);
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
    basePackage: "ts2hx"
  });

  const generatedFiles = walkFiles(outDir).sort((a, b) => a.localeCompare(b));
  const snapshotFiles = walkFiles(snapshotsDir).sort((a, b) => a.localeCompare(b));

  const update = process.env.UPDATE_SNAPSHOTS === "1";

  if (update) {
    rmrf(snapshotsDir);
    fs.mkdirSync(snapshotsDir, { recursive: true });
    for (const rel of generatedFiles) {
      const absSrc = path.join(outDir, rel);
      const absDest = path.join(snapshotsDir, rel);
      fs.mkdirSync(path.dirname(absDest), { recursive: true });
      fs.copyFileSync(absSrc, absDest);
    }
    process.stdout.write(`Updated snapshots in ${snapshotsDir}\n`);
    return 0;
  }

  const missingSnapshots = generatedFiles.filter((rel) => !fs.existsSync(path.join(snapshotsDir, rel)));
  const extraSnapshots = snapshotFiles.filter((rel) => !fs.existsSync(path.join(outDir, rel)));

  if (missingSnapshots.length > 0) {
    process.stderr.write(`Missing snapshot files:\n${missingSnapshots.map((p) => `  ${p}`).join("\n")}\n`);
    return 1;
  }

  if (extraSnapshots.length > 0) {
    process.stderr.write(`Extra snapshot files (stale):\n${extraSnapshots.map((p) => `  ${p}`).join("\n")}\n`);
    return 1;
  }

  for (const rel of generatedFiles) {
    const absGen = path.join(outDir, rel);
    const absSnap = path.join(snapshotsDir, rel);
    const gen = normalize(fs.readFileSync(absGen, "utf8"));
    const snap = normalize(fs.readFileSync(absSnap, "utf8"));
    if (gen !== snap) {
      process.stderr.write(`Snapshot mismatch: ${rel}\n`);
      return 1;
    }
  }

  process.stdout.write(`Snapshots OK (${generatedFiles.length} files)\n`);
  return 0;
}

process.exitCode = main();

