import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function run(cmd: string, args: ReadonlyArray<string>, opts: ExecFileSyncOptions = {}): void {
  execFileSync(cmd, [...args], {
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

run("node", ["scripts/dist/test-genes-ts.js"]);
run("node", ["scripts/dist/test-genes-ts-minimal.js"]);
run("node", ["scripts/dist/test-genes-ts-full.js"]);
run("node", ["scripts/dist/test-genes-tsx.js"]);
run("node", ["scripts/dist/test-genes-ts-sourcemaps.js"]);
run("node", ["scripts/dist/test-genes-ts-snapshots.js"]);

if (!skipTs2hx) {
  run("yarn", ["--cwd", "tools/ts2hx", "test"]);
}

if (!skipTodoapp) {
  run("node", [
    "scripts/dist/qa-todoapp.js",
    ...(skipPlaywright ? [] : ["--playwright"])
  ]);
}
