#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, "config", "toolchains.json"), "utf8")
);

const outputs = {
  // The blocking lane runs the exact supported floor. Using only the major
  // would silently move CI to the newest 22.x and leave 22.22.0 untested.
  "node-stable": manifest.node.minimumRuntime,
  "node-next-lts": manifest.node.nextLts,
  "haxe-stable": manifest.haxe.stable,
  "haxe-preview": manifest.haxe.preview
};
const rendered = Object.entries(outputs)
  .map(([key, value]) => `${key}=${value}`)
  .join("\n") + "\n";

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, rendered);
} else {
  process.stdout.write(rendered);
}
