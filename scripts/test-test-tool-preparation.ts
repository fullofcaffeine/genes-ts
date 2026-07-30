import {spawnSync} from "node:child_process";
import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const prepareScript = path.join(repoRoot, "scripts", "prepare-test-tools.mjs");
const distRoot = path.join(repoRoot, "scripts", "dist");
const stampPath = path.join(
  distRoot,
  ".prepared-test-tools.json"
);
const probeSource = path.join(
  repoRoot,
  "scripts",
  ".prepare-test-tools-probe.ts"
);

interface PreparedStamp {
  sourceHash: string;
  outputHash: string;
  outputs: string[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function prepare(): string {
  const result = spawnSync(process.execPath, [prepareScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1"
    },
    timeout: 120_000
  });
  if (result.error !== undefined) throw result.error;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert(result.status === 0, `Test-tool preparation failed:\n${output}`);
  return output;
}

function stamp(): PreparedStamp {
  return JSON.parse(readFileSync(stampPath, "utf8")) as PreparedStamp;
}

/**
 * Characterizes clean, warm, changed-input, corrupt-output, and missing-output
 * preparation without relying on an unverified `scripts/dist` cache.
 *
 * The temporary TypeScript input is created and removed inside `scripts/` so
 * it follows the same production source-inventory path as a real new runner.
 * `finally` always restores the ordinary source set and asks the preparer to
 * rebuild that exact identity before returning.
 */
function main(): void {
  rmSync(probeSource, {force: true});
  try {
    rmSync(distRoot, {recursive: true, force: true});
    assert(prepare().includes("[test-tools] rebuilt"),
      "A deleted scripts/dist tree did not trigger a clean rebuild");
    const initial = stamp();
    assert(prepare().includes("prepared cache hit"),
      "An unchanged aggregate did not reuse verified test tools");

    writeFileSync(probeSource, "export const preparationProbe = 1;\n");
    assert(prepare().includes("[test-tools] rebuilt"),
      "A changed test-tool source did not trigger a rebuild");
    const changed = stamp();
    assert(changed.sourceHash !== initial.sourceHash,
      "The prepared source identity ignored a new TypeScript input");

    rmSync(probeSource, {force: true});
    prepare();
    const restored = stamp();
    assert(restored.sourceHash === initial.sourceHash,
      "Removing the probe did not restore the original source identity");

    const output = restored.outputs.find((candidate) =>
      candidate.endsWith("/test-agent-guides.js"));
    assert(output !== undefined, "Prepared output inventory omitted a known runner");
    const outputPath = path.join(repoRoot, output);
    const expectedBytes = readFileSync(outputPath);
    writeFileSync(outputPath, `${expectedBytes.toString("utf8")}\n// corrupt\n`);
    assert(prepare().includes("[test-tools] rebuilt"),
      "A corrupt compiled runner was accepted as prepared");
    assert(readFileSync(outputPath).equals(expectedBytes),
      "Rebuilding did not restore deterministic compiled runner bytes");

    rmSync(outputPath);
    assert(!existsSync(outputPath), "Unable to remove prepared-output probe");
    assert(prepare().includes("[test-tools] rebuilt"),
      "A missing compiled runner was accepted as prepared");
    assert(readFileSync(outputPath).equals(expectedBytes),
      "Rebuilding did not restore the missing compiled runner");
  } finally {
    rmSync(probeSource, {force: true});
    prepare();
  }

  console.log("test-tool-preparation:ok (cold/warm/source/output guards)");
}

main();
