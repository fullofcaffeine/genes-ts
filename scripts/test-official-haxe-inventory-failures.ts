import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const runner = path.join(scriptDir, "test-official-haxe-inventory.js");
const result = spawnSync(process.execPath, [runner], {
  cwd: repoRoot,
  encoding: "utf8",
  env: {
    ...process.env,
    GENES_OFFICIAL_INVENTORY_INJECT: "profile-drift"
  },
  timeout: 300_000
});

if (result.error !== undefined) {
  throw new Error(`official inventory failure sentinel did not start: ${result.error.message}`);
}
if (result.status === 0) {
  throw new Error("official inventory accepted an injected TypeScript profile drift");
}
const output = `${result.stdout}${result.stderr}`;
if (!output.includes("typescript active inventory differs from the reviewed file")) {
  throw new Error(
    "official inventory drift did not report the reviewed-file boundary\n" + output
  );
}
process.stdout.write("official-haxe-inventory-failures:ok (profile drift stayed red)\n");
