import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...opts
  });
}

const skipClassic = process.env.SKIP_CLASSIC === "1";
const skipTodoapp = process.env.SKIP_TODOAPP === "1";
const skipPlaywright = process.env.SKIP_PLAYWRIGHT === "1";
const skipTs2hx = process.env.SKIP_TS2HX === "1";

if (!skipClassic) {
  run("npm", ["test"]);
}

run("node", ["scripts/test-genes-ts.mjs"]);
run("node", ["scripts/test-genes-ts-minimal.mjs"]);
run("node", ["scripts/test-genes-ts-full.mjs"]);
run("node", ["scripts/test-genes-tsx.mjs"]);
run("node", ["scripts/test-genes-ts-sourcemaps.mjs"]);

if (!skipTs2hx) {
  run("yarn", ["--cwd", "tools/ts2hx", "test"]);
}

if (!skipTodoapp) {
  run("node", [
    "scripts/qa-todoapp.mjs",
    ...(skipPlaywright ? [] : ["--playwright"])
  ]);
}
