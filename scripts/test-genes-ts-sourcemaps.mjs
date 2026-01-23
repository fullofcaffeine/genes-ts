import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function rmrf(relPath) {
  rmSync(path.join(repoRoot, relPath), { recursive: true, force: true });
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...opts
  });
}

rmrf("tests_ts/src-gen");
run("haxe", ["-debug", "tests_ts/build.hxml"]);

const tsPath = path.join(repoRoot, "tests_ts/src-gen/Main.ts");
const mapPath = path.join(repoRoot, "tests_ts/src-gen/Main.ts.map");

if (!existsSync(tsPath)) {
  throw new Error(`Expected generated TS at ${tsPath}`);
}
if (!existsSync(mapPath)) {
  throw new Error(`Expected Haxe→TS sourcemap at ${mapPath}`);
}

const map = JSON.parse(readFileSync(mapPath, "utf8"));
if (map.file !== "Main.ts") {
  throw new Error(`Expected sourcemap file to be Main.ts, got ${map.file}`);
}
if (!Array.isArray(map.sources) || !map.sources.includes("../src/Main.hx")) {
  throw new Error(`Expected sourcemap sources to include ../src/Main.hx`);
}

const ts = readFileSync(tsPath, "utf8");
if (!ts.includes("//# sourceMappingURL=Main.ts.map")) {
  throw new Error(`Expected generated TS to reference Main.ts.map`);
}

console.log("ok");

