#!/usr/bin/env node

import fs from "fs";
import path from "path";
import ts from "./typescript-api.js";
import {
  emitProjectToHaxe,
  type TranslationDiagnostic,
  type TranslationMode,
  type RuntimeProfile
} from "./haxe/emit.js";
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
      mode: TranslationMode;
      allowLoss: boolean;
      diagnosticsJson: string | null;
      runtimeModulesManifest: string | null;
      runtimeProfile: RuntimeProfile | null;
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
  --base-package        Valid dot-separated Haxe package prefix (default: ts2hx)
  --mode                 strict-js (default) or assisted
  --runtime-profile      genes-esm or standard-haxe-js (required with --out)
  --allow-loss           Map assisted-loss exit 3 to 0 (manifest remains lossy)
  --diagnostics-json     Publish an external manifest outside --out in the same CLI transaction
  --runtime-modules      Hash-pinned manifest for staged relative runtime modules
  --clean                Replace a dedicated output dir; default retires only prior manifest-owned files
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
  let mode: TranslationMode = "strict-js";
  let allowLoss = false;
  let diagnosticsJson: string | null = null;
  let runtimeModulesManifest: string | null = null;
  let runtimeProfile: RuntimeProfile | null = null;

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
    if (arg === "--mode") {
      const next = args[i + 1];
      if (next !== "strict-js" && next !== "assisted")
        return { kind: "error", message: "--mode must be strict-js or assisted." };
      mode = next;
      i++;
      continue;
    }
    if (arg === "--allow-loss") {
      allowLoss = true;
      continue;
    }
    if (arg === "--diagnostics-json") {
      const next = args[i + 1];
      if (!next) return { kind: "error", message: "Missing value for --diagnostics-json." };
      diagnosticsJson = next;
      i++;
      continue;
    }
    if (arg === "--runtime-modules") {
      const next = args[i + 1];
      if (!next) return { kind: "error", message: "Missing value for --runtime-modules." };
      runtimeModulesManifest = next;
      i++;
      continue;
    }
    if (arg === "--runtime-profile") {
      const next = args[i + 1];
      if (next !== "genes-esm" && next !== "standard-haxe-js") {
        return {
          kind: "error",
          message: "--runtime-profile must be genes-esm or standard-haxe-js."
        };
      }
      runtimeProfile = next;
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

  if (allowLoss && mode !== "assisted")
    return { kind: "error", message: "--allow-loss requires --mode assisted." };
  if (outDir !== null && runtimeProfile === null) {
    return {
      kind: "error",
      message: "--runtime-profile is required when --out emits Haxe."
    };
  }

  return {
    kind: "run",
    projectPath,
    listFiles,
    showDiagnostics,
    outDir,
    basePackage,
    cleanOutDir,
    mode,
    allowLoss,
    diagnosticsJson,
    runtimeModulesManifest,
    runtimeProfile
  };
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

function formatTranslationDiagnostic(diag: TranslationDiagnostic): string {
  return `${diag.source.file}:${diag.source.line}:${diag.source.column} - ${diag.id}: ${diag.message}`;
}

function inspectProject(opts: {
  projectPath: string;
  listFiles: boolean;
  showDiagnostics: boolean;
  outDir: string | null;
  basePackage: string;
  cleanOutDir: boolean;
  mode: TranslationMode;
  allowLoss: boolean;
  diagnosticsJson: string | null;
  runtimeModulesManifest: string | null;
  runtimeProfile: RuntimeProfile | null;
}): number {
  const loaded = loadProject(opts.projectPath);
  if (!loaded.ok) {
    const errors = loaded.diagnostics
      .slice()
      .sort((a, b) => (a.code ?? 0) - (b.code ?? 0))
      .map((e) => formatDiagnostic(loaded.projectDir, e));
    process.stderr.write(`${errors.join("\n")}\n`);
    return 2;
  }

  const projectDiagnostics = ts
    .getPreEmitDiagnostics(loaded.program)
    .slice()
    .sort((a, b) => {
      const af = a.file?.fileName ?? "";
      const bf = b.file?.fileName ?? "";
      if (af !== bf) return af.localeCompare(bf);
      return (a.start ?? 0) - (b.start ?? 0);
    });

  if (opts.showDiagnostics) {
    for (const diag of projectDiagnostics) {
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
    const projectErrors = projectDiagnostics.filter(
      diagnostic => diagnostic.category === ts.DiagnosticCategory.Error
    );
    if (projectErrors.length > 0) {
      if (!opts.showDiagnostics) {
        for (const diagnostic of projectErrors)
          process.stderr.write(`${formatDiagnostic(loaded.projectDir, diagnostic)}\n`);
      }
      process.stderr.write(
        "TypeScript project must type-check before effective module requests can be planned.\n"
      );
      return 2;
    }
    if (!opts.runtimeProfile) {
      throw new Error("An output translation reached emission without a runtime profile.");
    }
    const outAbsDir = path.resolve(opts.outDir);
    const emitted = emitProjectToHaxe({
      projectDir: loaded.projectDir,
      rootDir: loaded.rootDir,
      program: loaded.program,
      checker: loaded.checker,
      sourceFiles: loaded.sourceFiles,
      outDir: outAbsDir,
      basePackage: opts.basePackage,
      runtimeProfile: opts.runtimeProfile,
      mode: opts.mode,
      cleanOutDir: opts.cleanOutDir,
      runtimeModulesManifest: opts.runtimeModulesManifest ?? undefined,
      externalManifestPath: opts.diagnosticsJson ?? undefined
    });
    for (const diagnostic of emitted.diagnostics)
      process.stderr.write(`${formatTranslationDiagnostic(diagnostic)}\n`);

    if (emitted.status === "failed") {
      process.stderr.write("Translation failed closed; the previous output tree was not modified.\n");
      return 1;
    }

    process.stderr.write(`Wrote ${emitted.writtenFiles.length} file(s) to ${outAbsDir}\n`);
    if (emitted.status === "assisted")
      return opts.allowLoss ? 0 : 3;
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
    return 2;
  }

  try {
    return inspectProject(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`ts2hx internal failure: ${message}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv);
