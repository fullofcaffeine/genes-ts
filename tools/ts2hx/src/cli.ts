#!/usr/bin/env node

import fs from "fs";
import path from "path";
import ts from "typescript";
import { emitProjectToHaxe } from "./haxe/emit.js";
import { loadProject } from "./project.js";

type CliCommand =
  | { kind: "help" }
  | { kind: "version" }
  | {
      kind: "run";
      projectPath: string;
      listFiles: boolean;
      showDiagnostics: boolean;
      outDir: string | null;
      basePackage: string;
      cleanOutDir: boolean;
    };

function readPackageJsonVersion(argv1: string | undefined): string {
  try {
    if (!argv1) return "0.0.0";
    const scriptDir = path.dirname(path.resolve(argv1));
    const packageJsonPath = path.resolve(scriptDir, "../package.json");
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === "string") return version;
    }
    return "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printHelp() {
  process.stdout.write(`ts2hx (experimental)

Usage:
  ts2hx --help
  ts2hx --version
  ts2hx --project <path/to/tsconfig.json> --list-files

Options:
  --project, -p         Path to tsconfig.json (default: ./tsconfig.json)
  --list-files          Print project source files (sorted, path-relative)
  --diagnostics         Print TypeScript diagnostics (sorted)
  --out, -o             Emit Haxe into this directory
  --base-package        Haxe base package for generated modules (default: ts2hx)
  --clean               Delete output dir contents before emitting
`);
}

function parseArgs(argv: string[]): CliCommand | { kind: "error"; message: string } {
  const args = argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    return { kind: "help" };
  }

  if (args.includes("--version") || args.includes("-v")) {
    return { kind: "version" };
  }

  let projectPath = "tsconfig.json";
  let listFiles = false;
  let showDiagnostics = false;
  let outDir: string | null = null;
  let basePackage = "ts2hx";
  let cleanOutDir = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--project" || arg === "-p") {
      const next = args[i + 1];
      if (!next) return { kind: "error", message: "Missing value for --project." };
      projectPath = next;
      i++;
      continue;
    }
    if (arg === "--out" || arg === "-o") {
      const next = args[i + 1];
      if (!next) return { kind: "error", message: "Missing value for --out." };
      outDir = next;
      i++;
      continue;
    }
    if (arg === "--base-package") {
      const next = args[i + 1];
      if (!next) return { kind: "error", message: "Missing value for --base-package." };
      basePackage = next;
      i++;
      continue;
    }
    if (arg === "--clean") {
      cleanOutDir = true;
      continue;
    }
    if (arg === "--list-files") {
      listFiles = true;
      continue;
    }
    if (arg === "--diagnostics") {
      showDiagnostics = true;
      continue;
    }
    return { kind: "error", message: `Unknown arg: ${arg}` };
  }

  return { kind: "run", projectPath, listFiles, showDiagnostics, outDir, basePackage, cleanOutDir };
}

function formatDiagnostic(projectDir: string, diag: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diag.messageText, "\n");
  if (diag.file && typeof diag.start === "number") {
    const pos = diag.file.getLineAndCharacterOfPosition(diag.start);
    const filePath = path.relative(projectDir, diag.file.fileName);
    return `${filePath}:${pos.line + 1}:${pos.character + 1} - ${message}`;
  }
  return message;
}

function rmrf(absPath: string): void {
  if (!fs.existsSync(absPath)) return;
  const stat = fs.lstatSync(absPath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absPath)) {
      rmrf(path.join(absPath, entry));
    }
    fs.rmdirSync(absPath);
  } else {
    fs.unlinkSync(absPath);
  }
}

function inspectProject(opts: {
  projectPath: string;
  listFiles: boolean;
  showDiagnostics: boolean;
  outDir: string | null;
  basePackage: string;
  cleanOutDir: boolean;
}): number {
  const loaded = loadProject(opts.projectPath);
  if (!loaded.ok) {
    const errors = loaded.diagnostics
      .slice()
      .sort((a, b) => (a.code ?? 0) - (b.code ?? 0))
      .map((e) => formatDiagnostic(loaded.projectDir, e));
    process.stderr.write(`${errors.join("\n")}\n`);
    return 1;
  }

  if (opts.showDiagnostics) {
    const diagnostics = ts
      .getPreEmitDiagnostics(loaded.program)
      .slice()
      .sort((a, b) => {
        const af = a.file?.fileName ?? "";
        const bf = b.file?.fileName ?? "";
        if (af !== bf) return af.localeCompare(bf);
        return (a.start ?? 0) - (b.start ?? 0);
      });

    for (const diag of diagnostics) {
      process.stderr.write(`${formatDiagnostic(loaded.projectDir, diag)}\n`);
    }
  }

  if (opts.listFiles) {
    const files = loaded.rootFileNames
      .map((fileName) => path.relative(loaded.projectDir, fileName))
      .sort((a, b) => a.localeCompare(b));

    for (const file of files) {
      process.stdout.write(`${file}\n`);
    }
  }

  if (opts.outDir) {
    const outAbsDir = path.resolve(opts.outDir);
    if (opts.cleanOutDir) {
      rmrf(outAbsDir);
    }
    const emitted = emitProjectToHaxe({
      projectDir: loaded.projectDir,
      rootDir: loaded.rootDir,
      program: loaded.program,
      checker: loaded.checker,
      sourceFiles: loaded.sourceFiles,
      outDir: outAbsDir,
      basePackage: opts.basePackage
    });
    process.stderr.write(`Wrote ${emitted.writtenFiles.length} Haxe module(s) to ${outAbsDir}\n`);
  }

  return 0;
}

export function main(argv: string[]): number {
  const parsed = parseArgs(argv);

  if (parsed.kind === "help") {
    printHelp();
    return 0;
  }

  if (parsed.kind === "version") {
    const version = readPackageJsonVersion(argv[1]);
    process.stdout.write(`ts2hx v${version} (typescript v${ts.version})\n`);
    return 0;
  }

  if (parsed.kind === "error") {
    process.stderr.write(`${parsed.message}\n`);
    return 1;
  }

  return inspectProject(parsed);
}

process.exitCode = main(process.argv);
