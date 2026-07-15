#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, "config", "toolchains.json"), "utf8")
);

const outputs = {
  "node-stable": manifest.node.stable,
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
