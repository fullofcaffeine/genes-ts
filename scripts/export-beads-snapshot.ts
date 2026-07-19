import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type BeadsSnapshotContext = {
  readonly repoRoot: string;
  readonly snapshotPath: string;
};

function git(cwd: string, args: ReadonlyArray<string>): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function normalizedExistingPath(value: string): string {
  return realpathSync.native(path.resolve(value));
}

function primaryWorktree(cwd: string): string {
  const firstWorktree = git(cwd, ["worktree", "list", "--porcelain"])
    .split(/\r?\n/)
    .find((line) => line.startsWith("worktree "));
  if (!firstWorktree) {
    throw new Error("Git did not report a primary worktree");
  }
  return normalizedExistingPath(firstWorktree.slice("worktree ".length));
}

/**
 * Verifies the narrow context in which the tracked Beads snapshot may change.
 *
 * Why: every linked worktree shares one live Beads database. Exporting from a
 * feature worktree can therefore rewrite the primary checkout behind the
 * user's back.
 *
 * What: publication is admitted only from a clean primary `main` whose HEAD is
 * the fetched `origin/main`, with automatic export and staging disabled.
 *
 * How: all decisions use Git's repository identities and the checked-in Beads
 * configuration. Generated names, branch guesses, and ambient shell state do
 * not participate. The function performs no writes, so tests can exercise each
 * refusal before the real `bd export` boundary is reached.
 */
export function validateBeadsSnapshotContext(cwd: string): BeadsSnapshotContext {
  const repoRoot = normalizedExistingPath(git(cwd, ["rev-parse", "--show-toplevel"]));
  const primaryRoot = primaryWorktree(cwd);
  if (repoRoot !== primaryRoot) {
    throw new Error(
      "Beads snapshot publication is allowed only from the primary Git worktree"
    );
  }

  const branch = git(repoRoot, ["branch", "--show-current"]);
  if (branch !== "main") {
    throw new Error(`Beads snapshot publication requires main, found ${branch || "detached HEAD"}`);
  }

  let remoteMain: string;
  try {
    remoteMain = git(repoRoot, [
      "rev-parse",
      "--verify",
      "refs/remotes/origin/main"
    ]);
  } catch {
    throw new Error(
      "origin/main is unavailable; fetch it before publishing the Beads snapshot"
    );
  }
  const head = git(repoRoot, ["rev-parse", "HEAD"]);
  if (head !== remoteMain) {
    throw new Error(
      "Local main must equal origin/main before publishing the Beads snapshot"
    );
  }

  const status = git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.length > 0) {
    throw new Error(
      "The primary checkout must be completely clean before publishing the Beads snapshot"
    );
  }

  const configPath = path.join(repoRoot, ".beads/config.yaml");
  const config = readFileSync(configPath, "utf8");
  if (!/^export\.auto:\s*false\s*$/m.test(config)) {
    throw new Error(".beads/config.yaml must set export.auto: false");
  }
  if (!/^export\.git-add:\s*false\s*$/m.test(config)) {
    throw new Error(".beads/config.yaml must set export.git-add: false");
  }

  return {
    repoRoot,
    snapshotPath: path.join(repoRoot, ".beads/issues.jsonl")
  };
}

function pathsChangedAfterExport(repoRoot: string): string[] {
  // Porcelain's first two columns contain the staged and working-tree states.
  // Do not pass this output through `git()` because its `.trim()` would remove
  // the leading space that distinguishes an unstaged change.
  const status = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }
  ).trimEnd();
  if (status.length === 0) return [];
  return status.split(/\r?\n/).map((line) => line.slice(3));
}

/** Publishes the reviewed issue snapshot without staging or committing it. */
export function exportBeadsSnapshot(cwd: string): void {
  const context = validateBeadsSnapshotContext(cwd);
  const env = {
    ...process.env,
    BD_EXPORT_AUTO: "false",
    BD_EXPORT_GIT_ADD: "false"
  };
  const result = spawnSync("bd", ["export", "-o", context.snapshotPath], {
    cwd: context.repoRoot,
    env,
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `bd export failed with status ${String(result.status)}\n${result.stdout}${result.stderr}`
    );
  }

  const expected = ".beads/issues.jsonl";
  const changed = pathsChangedAfterExport(context.repoRoot);
  const unexpected = changed.filter((entry) => entry !== expected);
  if (unexpected.length > 0) {
    throw new Error(
      `Beads snapshot publication changed unexpected paths: ${unexpected.join(", ")}`
    );
  }

  if (changed.length === 0) {
    console.log("beads-export:ok (snapshot already current; nothing staged)");
  } else {
    console.log(
      "beads-export:ok (.beads/issues.jsonl refreshed; review the diff before staging)"
    );
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    exportBeadsSnapshot(process.cwd());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`beads-export:failed: ${message}`);
    process.exitCode = 1;
  }
}
