import { ok, strictEqual, throws } from "node:assert";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PINNED_BEADS_IDENTITY,
  pinnedBeadsPath,
  requirePinnedBeads
} from "./beads-client.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function writeExecutable(file: string, source: string): void {
  writeFileSync(file, source);
  chmodSync(file, 0o755);
}

/**
 * Proves that repository-owned Beads operations use an exact source identity.
 *
 * Why: official Beads 1.1.2 understands schema v53, while an unreleased build
 * still labelled 1.1.0 contains migration v59. Comparing only the semantic
 * version would admit the wrong client and strand every linked worktree.
 *
 * What/How: the real Genes installation must report the reviewed commit; two
 * disposable repositories prove that a missing binary and a plausible-looking
 * official version fail before execution. The primary and linked Genes
 * worktrees must resolve the same common-Git-directory path.
 */
function main(): void {
  const binary = requirePinnedBeads(repositoryRoot);
  strictEqual(
    execFileSync(binary, ["version"], { encoding: "utf8" }).trim(),
    PINNED_BEADS_IDENTITY
  );

  const primary = git(repositoryRoot, ["worktree", "list", "--porcelain"])
    .split(/\r?\n/)
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length);
  ok(primary, "Git did not report the primary worktree");
  strictEqual(
    pinnedBeadsPath(repositoryRoot),
    pinnedBeadsPath(primary),
    "linked worktrees did not resolve one shared Beads client"
  );

  const root = mkdtempSync(path.join(tmpdir(), "genes-beads-pin-"));
  const missing = path.join(root, "missing");
  const wrong = path.join(root, "wrong");
  try {
    for (const candidate of [missing, wrong]) {
      mkdirSync(candidate);
      git(candidate, ["init", "-b", "main"]);
    }
    throws(
      () => requirePinnedBeads(missing),
      /missing or unavailable[\s\S]*yarn beads:install/
    );

    const wrongDirectory = path.dirname(pinnedBeadsPath(wrong));
    mkdirSync(wrongDirectory, { recursive: true });
    writeExecutable(
      path.join(wrongDirectory, "bd"),
      "#!/usr/bin/env sh\nprintf '%s\\n' 'bd version 1.1.2 (official: main@20e493e569c9)'\n"
    );
    throws(
      () => requirePinnedBeads(wrong),
      /Expected: bd version 1\.1\.0 \(genes-pinned:[\s\S]*Actual: bd version 1\.1\.2/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const installer = readFileSync(
    path.join(repositoryRoot, "scripts/beads/install-pinned.sh"),
    "utf8"
  );
  ok(
    installer.includes("0059_recompute_null_gate_is_blocked.up.sql"),
    "installer does not assert required schema migration 0059"
  );
  ok(
    installer.includes(
      "c2903ff26ca0554a1edf0551094ec4ce30ccfd1595aa746944633995f2801ec6"
    ),
    "installer does not pin the reviewed source archive checksum"
  );

  process.stdout.write(
    "beads-pin:ok (exact commit + shared worktree client + mismatch refusals)\n"
  );
}

main();
