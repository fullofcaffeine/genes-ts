import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export type AssertNoUnsafeTypesOptions = {
  repoRoot: string;
  generatedDir: string;
  fileExts: ReadonlyArray<string>;
  ignoreTopLevelDirs?: ReadonlyArray<string>;
};

type Match = {
  file: string;
  line: number;
  text: string;
};

function collectFiles(dir: string, exts: ReadonlySet<string>, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      collectFiles(abs, exts, out);
      continue;
    }
    if (st.isFile()) {
      const ext = path.extname(entry);
      if (exts.has(ext)) out.push(abs);
    }
  }
}

function isIgnored(relPath: string, ignoreTopLevelDirs: ReadonlySet<string>): boolean {
  const parts = relPath.split(path.sep).filter(Boolean);
  if (parts.length === 0) return false;
  return ignoreTopLevelDirs.has(parts[0] ?? "");
}

export function assertNoUnsafeTypes({
  repoRoot,
  generatedDir,
  fileExts,
  ignoreTopLevelDirs = []
}: AssertNoUnsafeTypesOptions): void {
  const absGeneratedDir = path.join(repoRoot, generatedDir);
  const exts = new Set(fileExts);
  const ignore = new Set(ignoreTopLevelDirs);

  const files: string[] = [];
  collectFiles(absGeneratedDir, exts, files);

  const forbidden = [
    /\bas any\b/,
    /\bas unknown\b/,
    /:\s*any\b/,
    /:\s*unknown\b/,
    /<\s*any\b/,
    /<\s*unknown\b/
  ];

  const matches: Match[] = [];
  for (const absFile of files) {
    const rel = path.relative(absGeneratedDir, absFile);
    if (isIgnored(rel, ignore)) continue;
    const text = readFileSync(absFile, "utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i] ?? "";
      if (forbidden.some((re) => re.test(lineText))) {
        matches.push({ file: path.join(generatedDir, rel), line: i + 1, text: lineText });
        if (matches.length >= 50) break;
      }
    }
    if (matches.length >= 50) break;
  }

  if (matches.length > 0) {
    const details = matches
      .map((m) => `${m.file}:${m.line}: ${m.text}`)
      .join("\n");
    throw new Error(
      [
        "Generated TS typing policy violation:",
        "- Found `any`/`unknown` in non-runtime files.",
        "- Fix the emitter or move the dynamic typing behind the runtime boundary.",
        "",
        details
      ].join("\n")
    );
  }
}

