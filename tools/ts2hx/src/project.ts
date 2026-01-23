import path from "path";
import ts from "typescript";

export type LoadProjectResult =
  | {
      ok: true;
      projectDir: string;
      rootDir: string;
      program: ts.Program;
      checker: ts.TypeChecker;
      rootFileNames: string[];
      sourceFiles: ts.SourceFile[];
    }
  | {
      ok: false;
      projectDir: string;
      diagnostics: ts.Diagnostic[];
    };

function commonDirectory(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  let common = path.dirname(path.resolve(paths[0] ?? "."));
  for (const p of paths.slice(1)) {
    const abs = path.resolve(p);
    while (common.length > 1 && !abs.startsWith(common + path.sep) && abs !== common) {
      common = path.dirname(common);
    }
  }
  return common.length > 0 ? common : null;
}

export function loadProject(projectPath: string): LoadProjectResult {
  const resolvedProjectPath = path.resolve(projectPath);
  const projectDir = path.dirname(resolvedProjectPath);

  const configFile = ts.readConfigFile(resolvedProjectPath, ts.sys.readFile);
  if (configFile.error) {
    return { ok: false, projectDir, diagnostics: [configFile.error] };
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    projectDir,
    /*existingOptions*/ undefined,
    resolvedProjectPath
  );

  if (parsed.errors.length > 0) {
    return { ok: false, projectDir, diagnostics: parsed.errors };
  }

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options
  });

  const checker = program.getTypeChecker();

  const rootDir =
    typeof parsed.options.rootDir === "string"
      ? parsed.options.rootDir
      : commonDirectory(parsed.fileNames) ?? projectDir;

  const rootFileNames = program.getRootFileNames().slice().sort((a, b) => a.localeCompare(b));
  const sourceFiles = rootFileNames
    .map((fileName) => program.getSourceFile(fileName))
    .filter((file): file is ts.SourceFile => !!file);

  return {
    ok: true,
    projectDir,
    rootDir,
    program,
    checker,
    rootFileNames,
    sourceFiles
  };
}
