#!/usr/bin/env node

import fs from "fs";
import path from "path";
import ts from "typescript";

function readPackageJsonVersion() {
  const packageJsonPath = new URL("../package.json", import.meta.url);
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw);
  return typeof parsed.version === "string" ? parsed.version : "0.0.0";
}

function printHelp() {
  process.stdout.write(`ts2hx (experimental)

Usage:
  ts2hx --help
  ts2hx --version
`);
}

function main(argv) {
  const args = argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }

  if (args.includes("--version") || args.includes("-v")) {
    const version = readPackageJsonVersion();
    process.stdout.write(`ts2hx v${version} (typescript v${ts.version})\n`);
    return 0;
  }

  const invokedAs = path.basename(argv[1] ?? "ts2hx");
  process.stderr.write(`Unknown args for ${invokedAs}. Run --help.\n`);
  return 1;
}

process.exitCode = main(process.argv);
