#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const manifestPath = path.join(repoRoot, "config", "toolchains.json");

function fail(message) {
  process.stderr.write(`run-typescript: ${message}\n`);
  process.exitCode = 2;
}

const [laneName, ...compilerArgs] = process.argv.slice(2);
if (!laneName) {
  fail("expected a lane name followed by TypeScript compiler arguments");
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const lane = manifest?.typescript?.[laneName];
  if (!lane || typeof lane.dependency !== "string" || typeof lane.binary !== "string") {
    fail(`unknown or invalid lane ${JSON.stringify(laneName)}`);
  } else {
    const packageRoot = path.join(repoRoot, "node_modules", ...lane.dependency.split("/"));
    const compilerBin = path.join(packageRoot, ...lane.binary.split("/"));
    const engine = lane.programApiEngine;
    const engineLabel = engine
      && typeof engine.package === "string"
      && typeof engine.version === "string"
      ? ` (Program API engine ${engine.package}@${engine.version})`
      : "";
    process.stdout.write(
      `[toolchain] TypeScript ${laneName}: ${lane.package}@${lane.version}${engineLabel}\n`
    );
    execFileSync(process.execPath, [compilerBin, ...compilerArgs], {
      cwd: process.cwd(),
      stdio: "inherit"
    });
  }
}
