#!/usr/bin/env node

import fs from "fs";
import path from "path";
import ts from "typescript";

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
`);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }

  if (args.includes("--version") || args.includes("-v")) {
    const version = readPackageJsonVersion(argv[1]);
    process.stdout.write(`ts2hx v${version} (typescript v${ts.version})\n`);
    return 0;
  }

  const invokedAs = path.basename(argv[1] ?? "ts2hx");
  process.stderr.write(`Unknown args for ${invokedAs}. Run --help.\n`);
  return 1;
}

process.exitCode = main(process.argv);

