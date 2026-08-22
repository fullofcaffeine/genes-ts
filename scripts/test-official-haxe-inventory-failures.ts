import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const runner = path.join(scriptDir, "test-official-haxe-inventory.js");
function expectFailure(injection: string, expected: string): void {
  const result = spawnSync(process.execPath, [runner], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GENES_OFFICIAL_INVENTORY_INJECT: injection
    },
    timeout: 300_000
  });
  if (result.error !== undefined) {
    throw new Error(`official inventory failure sentinel did not start: ${result.error.message}`);
  }
  if (result.status === 0) {
    throw new Error(`official inventory accepted injected ${injection}`);
  }
  const output = `${result.stdout}${result.stderr}`;
  if (!output.includes(expected)) {
    throw new Error(`official inventory ${injection} reported the wrong boundary\n${output}`);
  }
}

expectFailure("profile-drift",
  "typescript active inventory differs from the reviewed file");
expectFailure("cache-hash-drift",
  "haxe cached source tree differs from its reviewed revision");
process.stdout.write(
  "official-haxe-inventory-failures:ok (profile and cache drift stayed red)\n"
);
