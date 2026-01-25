import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

type AssertDirSnapshotsOptions = {
  repoRoot: string;
  generatedDir: string;
  snapshotsDir: string;
  fileExts: ReadonlyArray<string>;
  updateHint?: string;
};

function normalizeSnapshotText(text: string): string {
  let normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+$/gm, "");
  normalized = normalized.replace(/\n*$/, "");
  return `${normalized}\n`;
}

function listFilesRecursive(rootDir: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  }
  if (statExists(rootDir)) walk(rootDir);
  return out;
}

function statExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

function writeFileEnsuringDir(filePath: string, contents: string): void {
  ensureDir(path.dirname(filePath));
  writeFileSync(filePath, contents, "utf8");
}

function runGitDiff(a: string, b: string): void {
  try {
    execFileSync("git", ["--no-pager", "diff", "--no-index", "--", a, b], {
      stdio: "inherit"
    });
  } catch {
    // git diff exits 1 for differences; we still want to continue reporting.
  }
}

export function assertDirSnapshots({
  repoRoot,
  generatedDir,
  snapshotsDir,
  fileExts,
  updateHint
}: AssertDirSnapshotsOptions): void {
  const update = process.env.UPDATE_SNAPSHOTS === "1" || process.env.UPDATE_SNAPSHOTS === "true";

  const absGeneratedDir = path.join(repoRoot, generatedDir);
  const absSnapshotsDir = path.join(repoRoot, snapshotsDir);

  const genFiles = listFilesRecursive(absGeneratedDir)
    .filter((p) => fileExts.some((ext) => p.endsWith(ext)))
    .sort();

  if (update) {
    rmSync(absSnapshotsDir, { recursive: true, force: true });
    for (const absGen of genFiles) {
      const rel = path.relative(absGeneratedDir, absGen);
      const absSnap = path.join(absSnapshotsDir, rel);
      writeFileEnsuringDir(absSnap, normalizeSnapshotText(readFileSync(absGen, "utf8")));
    }
    return;
  }

  const snapFiles = listFilesRecursive(absSnapshotsDir)
    .filter((p) => fileExts.some((ext) => p.endsWith(ext)))
    .sort();

  const genRel = new Set(genFiles.map((p) => path.relative(absGeneratedDir, p)));
  const snapRel = new Set(snapFiles.map((p) => path.relative(absSnapshotsDir, p)));

  const missing = [...genRel].filter((p) => !snapRel.has(p)).sort();
  const extra = [...snapRel].filter((p) => !genRel.has(p)).sort();

  let failed = false;
  if (missing.length > 0) {
    failed = true;
    console.error(`Snapshot missing ${missing.length} file(s) under ${snapshotsDir}:`);
    for (const f of missing) console.error(`  - ${f}`);
  }
  if (extra.length > 0) {
    failed = true;
    console.error(`Snapshot has ${extra.length} extra file(s) under ${snapshotsDir}:`);
    for (const f of extra) console.error(`  - ${f}`);
  }

  const mismatched: string[] = [];
  for (const rel of [...genRel].filter((p) => snapRel.has(p)).sort()) {
    const absGen = path.join(absGeneratedDir, rel);
    const absSnap = path.join(absSnapshotsDir, rel);
    const genText = normalizeSnapshotText(readFileSync(absGen, "utf8"));
    const snapText = normalizeSnapshotText(readFileSync(absSnap, "utf8"));
    if (genText !== snapText) mismatched.push(rel);
  }

  if (mismatched.length > 0) {
    failed = true;
    console.error(`Snapshot mismatch in ${mismatched.length} file(s):`);
    for (const rel of mismatched.slice(0, 3)) {
      console.error(`\n--- ${rel}`);
      runGitDiff(path.join(absSnapshotsDir, rel), path.join(absGeneratedDir, rel));
    }
    if (mismatched.length > 3) {
      console.error(`(and ${mismatched.length - 3} more...)`);
    }
  }

  if (failed) {
    console.error(`\nTo update snapshots: ${updateHint ?? "UPDATE_SNAPSHOTS=1 yarn test:genes-ts:snapshots"}`);
    process.exit(1);
  }
}
