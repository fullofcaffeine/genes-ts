import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertDirSnapshots } from "./snapshots.js";

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

type SnapshotCase = {
  name: string;
  buildHxml: string;
  outDir: string;
  intendedDir: string;
  fileExts: ReadonlyArray<string>;
};

const cases: ReadonlyArray<SnapshotCase> = [
  {
    name: "basic",
    buildHxml: "tests/genes-ts/snapshot/basic/build.hxml",
    outDir: "tests/genes-ts/snapshot/basic/out/src-gen",
    intendedDir: "tests/genes-ts/snapshot/basic/intended",
    fileExts: [".ts"]
  },
  {
    name: "minimal",
    buildHxml: "tests/genes-ts/snapshot/minimal/build.hxml",
    outDir: "tests/genes-ts/snapshot/minimal/out/src-gen",
    intendedDir: "tests/genes-ts/snapshot/minimal/intended",
    fileExts: [".ts"]
  },
  {
    name: "react/tsx",
    buildHxml: "tests/genes-ts/snapshot/react/build-tsx.hxml",
    outDir: "tests/genes-ts/snapshot/react/out/tsx/src-gen",
    intendedDir: "tests/genes-ts/snapshot/react/intended/tsx",
    fileExts: [".ts", ".tsx"]
  },
  {
    name: "react/tsx-classic",
    buildHxml: "tests/genes-ts/snapshot/react/build-tsx-classic.hxml",
    outDir: "tests/genes-ts/snapshot/react/out/tsx-classic/src-gen",
    intendedDir: "tests/genes-ts/snapshot/react/intended/tsx-classic",
    fileExts: [".ts", ".tsx"]
  },
  {
    name: "react/ts",
    buildHxml: "tests/genes-ts/snapshot/react/build-ts.hxml",
    outDir: "tests/genes-ts/snapshot/react/out/ts/src-gen",
    intendedDir: "tests/genes-ts/snapshot/react/intended/ts",
    fileExts: [".ts", ".tsx"]
  }
];

for (const c of cases) {
  // Keep the output on disk so `intended vs out` diffs are easy to inspect.
  rmrf(path.dirname(c.outDir));
  run("haxe", [c.buildHxml]);
  assertDirSnapshots({
    repoRoot,
    generatedDir: c.outDir,
    snapshotsDir: c.intendedDir,
    fileExts: c.fileExts
  });
}
