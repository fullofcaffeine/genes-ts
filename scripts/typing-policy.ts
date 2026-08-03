import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "./typescript-api.js";

export type AssertNoUnsafeTypesOptions = {
  repoRoot: string;
  generatedDir: string;
  fileExts: ReadonlyArray<string>;
  ignoreTopLevelDirs?: ReadonlyArray<string>;
  allowUnsafeTypeFiles?: ReadonlyArray<string>;
};

export type UnsafeTypeMatch = {
  file: string;
  line: number;
  text: string;
};

/**
 * Finds actual TypeScript `any` and `unknown` type nodes.
 *
 * A text regex used to miss later generic arguments such as
 * `Request<Params, unknown, unknown>`. Parsing the syntax also avoids treating
 * explanatory comments or string literals as unsafe types.
 */
export function findUnsafeTypeKeywords(file: string, text: string): UnsafeTypeMatch[] {
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind);
  const lines = text.split(/\r?\n/);
  const matches: UnsafeTypeMatch[] = [];

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword || node.kind === ts.SyntaxKind.UnknownKeyword) {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      matches.push({
        file,
        line: position.line + 1,
        text: lines[position.line] ?? ""
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return matches;
}

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
  ignoreTopLevelDirs = [],
  allowUnsafeTypeFiles = []
}: AssertNoUnsafeTypesOptions): void {
  const absGeneratedDir = path.join(repoRoot, generatedDir);
  const exts = new Set(fileExts);
  const ignore = new Set(ignoreTopLevelDirs);
  const allowedFiles = new Set(allowUnsafeTypeFiles.map((file) => file.split(/[\\/]+/).join(path.sep)));

  const files: string[] = [];
  collectFiles(absGeneratedDir, exts, files);

  const matches: UnsafeTypeMatch[] = [];
  for (const absFile of files) {
    const rel = path.relative(absGeneratedDir, absFile);
    if (isIgnored(rel, ignore)) continue;
    if (allowedFiles.has(rel)) continue;
    const text = readFileSync(absFile, "utf8");
    matches.push(...findUnsafeTypeKeywords(path.join(generatedDir, rel), text));
    if (matches.length > 50) matches.length = 50;
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
