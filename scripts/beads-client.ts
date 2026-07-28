import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

export const PINNED_BEADS_IDENTITY =
  "bd version 1.1.0 (genes-pinned: main@7eb428cde13c)";

/** Returns the one Beads client shared by every linked Genes worktree. */
export function pinnedBeadsPath(repositoryRoot: string): string {
  const commonGitDirectory = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: repositoryRoot, encoding: "utf8" }
  ).trim();
  return path.join(commonGitDirectory, "genes-tools", "bd");
}

/**
 * Verifies the exact client before a repository-owned Beads operation.
 *
 * Why: an unreleased client labelled `1.1.0` migrated the shared database to
 * schema v59, while the later official `1.1.2` release understood only v53.
 * The semantic version is therefore not a sufficient compatibility identity.
 *
 * What: Genes admits only the reviewed source commit embedded by
 * `yarn beads:install`. Missing clients and every other build fail before a
 * database command is attempted.
 *
 * How: linked worktrees resolve the same binary through Git's common
 * directory. The exact build label and commit, rather than `PATH` order or a
 * neighboring repository cache, form the local trust boundary.
 */
export function requirePinnedBeads(repositoryRoot: string): string {
  const binary = pinnedBeadsPath(repositoryRoot);
  const result = spawnSync(binary, ["version"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  const identity = result.status === 0 ? result.stdout.trim() : "";
  if (identity !== PINNED_BEADS_IDENTITY) {
    throw new Error(
      [
        `Genes requires its pinned Beads client at ${binary}.`,
        `Expected: ${PINNED_BEADS_IDENTITY}`,
        `Actual: ${identity || "missing or unavailable"}`,
        "Run: yarn beads:install"
      ].join("\n")
    );
  }
  return binary;
}
