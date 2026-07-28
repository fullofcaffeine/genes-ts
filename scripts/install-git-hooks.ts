import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PINNED_BEADS_IDENTITY,
  requirePinnedBeads
} from "./beads-client.js";

const BEADS_MARKER = "# --- BEGIN BEADS INTEGRATION";
const GENES_BEADS_MARKER_BEGIN = "# --- BEGIN GENES PINNED BEADS v1 ---";
const GENES_BEADS_MARKER_END = "# --- END GENES PINNED BEADS v1 ---";
const GENES_MARKER_BEGIN = "# --- BEGIN GENES PRE-COMMIT v1 ---";
const GENES_MARKER_END = "# --- END GENES PRE-COMMIT v1 ---";

function repositoryRootFromArgs(): string {
  const rootIndex = process.argv.indexOf("--repo-root");
  if (rootIndex >= 0) {
    const value = process.argv[rootIndex + 1];
    if (!value) {
      throw new Error("--repo-root requires a path");
    }
    return path.resolve(value);
  }

  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8"
  }).trim();
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function repositorySection(): string {
  return [
    GENES_MARKER_BEGIN,
    "# This section is owned by scripts/install-git-hooks.ts.",
    '_genes_root="$(git rev-parse --show-toplevel)" || exit 1',
    '_genes_hook="$_genes_root/scripts/hooks/pre-commit"',
    'if [ ! -x "$_genes_hook" ]; then',
    '  echo >&2 "genes: repository pre-commit runner is missing or not executable: $_genes_hook"',
    '  echo >&2 "genes: update this worktree, then run: yarn hooks:install"',
    "  exit 1",
    "fi",
    '"$_genes_hook" "$@"',
    "_genes_exit=$?",
    "if [ $_genes_exit -ne 0 ]; then exit $_genes_exit; fi",
    "unset _genes_root _genes_hook _genes_exit",
    GENES_MARKER_END
  ].join("\n");
}

function pinnedBeadsSection(): string {
  return [
    GENES_BEADS_MARKER_BEGIN,
    "# Genes worktrees share one database, so every Beads hook must share one client.",
    '_genes_bd_common="$(git rev-parse --path-format=absolute --git-common-dir)" || exit 1',
    '_genes_bd_bin="$_genes_bd_common/genes-tools/bd"',
    `if [ ! -x "$_genes_bd_bin" ] || [ "$("$_genes_bd_bin" version 2>/dev/null | tr -d '\\r\\n')" != "${PINNED_BEADS_IDENTITY}" ]; then`,
    '  echo >&2 "genes-beads: the verified repository client is missing or has the wrong identity"',
    '  echo >&2 "genes-beads: run: yarn beads:install && yarn hooks:install"',
    "  exit 1",
    "fi",
    'PATH="$(dirname "$_genes_bd_bin"):$PATH"',
    "export PATH",
    "unset _genes_bd_common _genes_bd_bin",
    GENES_BEADS_MARKER_END
  ].join("\n");
}

function installRepositorySection(hookPath: string): void {
  const original = readFileSync(hookPath, "utf8");
  const beginCount = countOccurrences(original, GENES_MARKER_BEGIN);
  const endCount = countOccurrences(original, GENES_MARKER_END);
  if (beginCount !== endCount || beginCount > 1) {
    throw new Error(
      `Refusing to repair malformed Genes pre-commit markers in ${hookPath}`
    );
  }

  const block = repositorySection();
  const updated =
    beginCount === 1
      ? original.replace(
          new RegExp(
            `${GENES_MARKER_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${GENES_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
          ),
          block
        )
      : `${original.trimEnd()}\n\n${block}\n`;

  const temporaryPath = `${hookPath}.genes-${process.pid}.tmp`;
  writeFileSync(temporaryPath, updated, { mode: statSync(hookPath).mode });
  chmodSync(temporaryPath, 0o755);
  renameSync(temporaryPath, hookPath);
}

function installPinnedBeadsSection(hookPath: string): void {
  const original = readFileSync(hookPath, "utf8");
  const beginCount = countOccurrences(original, GENES_BEADS_MARKER_BEGIN);
  const endCount = countOccurrences(original, GENES_BEADS_MARKER_END);
  if (beginCount !== endCount || beginCount > 1) {
    throw new Error(
      `Refusing to repair malformed Genes Beads markers in ${hookPath}`
    );
  }

  const block = pinnedBeadsSection();
  const withoutExisting =
    beginCount === 1
      ? original.replace(
          new RegExp(
            `${GENES_BEADS_MARKER_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${GENES_BEADS_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n*`
          ),
          ""
        )
      : original;
  const updated = `${block}\n${withoutExisting.trimStart()}`;
  const temporaryPath = `${hookPath}.genes-beads-${process.pid}.tmp`;
  writeFileSync(temporaryPath, updated, { mode: statSync(hookPath).mode });
  chmodSync(temporaryPath, 0o755);
  renameSync(temporaryPath, hookPath);
}

function beadsOverrideFromArgs(): string | undefined {
  const index = process.argv.indexOf("--beads-bin");
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value) throw new Error("--beads-bin requires a path");
  return path.resolve(value);
}

/**
 * Installs the repository pre-commit guard without taking ownership from Beads.
 *
 * Why: linked worktrees share `.git/hooks`, and Beads regenerates its own
 * marked section during upgrades. Replacing that file wholesale would silently
 * disable issue-tracker safety or lose the security hook later.
 *
 * What: Beads installs its supported common-hook shim, then this installer
 * adds one independently marked repository section. No package installation
 * mutates Git configuration automatically; contributors opt in explicitly via
 * `yarn hooks:install`.
 *
 * How: Beads guarantees that content outside its marker survives reinstall.
 * This installer likewise replaces only the Genes marker, making repeated
 * installation deterministic while preserving unrelated user hook content.
 */
function main(): void {
  const repositoryRoot = repositoryRootFromArgs();
  const hooksPath = spawnSync("git", ["config", "--get", "core.hooksPath"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  if (hooksPath.status === 0 && hooksPath.stdout.trim().length > 0) {
    throw new Error(
      `core.hooksPath is already set to ${hooksPath.stdout.trim()}; unset it before installing the shared Genes/Beads hook`
    );
  }

  const override = beadsOverrideFromArgs();
  const ownerRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
  );
  if (override && repositoryRoot === ownerRoot) {
    throw new Error(
      "--beads-bin is a disposable-fixture seam and cannot override the live Genes client"
    );
  }
  const beadsBinary = override ?? requirePinnedBeads(repositoryRoot);
  const beads = spawnSync(beadsBinary, ["hooks", "install", "--chain"], {
    cwd: repositoryRoot,
    stdio: "inherit"
  });
  if (beads.error && "code" in beads.error && beads.error.code === "ENOENT") {
    throw new Error(
      "The selected Beads client is unavailable. Run yarn beads:install, then rerun yarn hooks:install"
    );
  }
  if (beads.status !== 0) {
    throw new Error(
      `Pinned bd hooks install --chain failed (exit ${beads.status ?? "unknown"})`
    );
  }

  const commonGitDirectory = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: repositoryRoot, encoding: "utf8" }
  ).trim();
  const hooksDirectory = path.join(commonGitDirectory, "hooks");
  if (!override) {
    for (const name of readdirSync(hooksDirectory).sort()) {
      const candidate = path.join(hooksDirectory, name);
      if (!statSync(candidate).isFile()) continue;
      const source = readFileSync(candidate, "utf8");
      if (source.includes(BEADS_MARKER)) installPinnedBeadsSection(candidate);
    }
  }
  const hookPath = path.join(commonGitDirectory, "hooks", "pre-commit");
  installRepositorySection(hookPath);

  const installed = readFileSync(hookPath, "utf8");
  if (
    countOccurrences(installed, BEADS_MARKER) !== 1 ||
    (!override &&
      (countOccurrences(installed, GENES_BEADS_MARKER_BEGIN) !== 1 ||
        countOccurrences(installed, GENES_BEADS_MARKER_END) !== 1)) ||
    countOccurrences(installed, GENES_MARKER_BEGIN) !== 1 ||
    countOccurrences(installed, GENES_MARKER_END) !== 1
  ) {
    throw new Error(`Installed pre-commit hook failed ownership verification: ${hookPath}`);
  }

  console.log(`[hooks] Installed Beads and Genes pre-commit checks: ${hookPath}`);
  console.log("[hooks] Staged .hx files will be formatted; all staged files will be scanned for secrets.");
}

try {
  main();
} catch (error) {
  console.error(
    `[hooks] ERROR: ${error instanceof Error ? error.message : "hook installation failed"}`
  );
  process.exitCode = 1;
}
