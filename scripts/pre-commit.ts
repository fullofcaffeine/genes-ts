import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";
import { scanWithGitleaks } from "./security/gitleaks.js";

class PreCommitError extends Error {}

const HAXE_FORMATTER_VERSION = "1.18.0";

function git(repositoryRoot: string, args: ReadonlyArray<string>): Buffer {
  return execFileSync("git", [...args], {
    cwd: repositoryRoot,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "inherit"]
  });
}

function repositoryRootFromArgs(): string {
  const rootIndex = process.argv.indexOf("--repo-root");
  if (rootIndex >= 0) {
    const value = process.argv[rootIndex + 1];
    if (!value) {
      throw new PreCommitError("--repo-root requires a path");
    }
    return path.resolve(value);
  }

  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8"
  }).trim();
}

function stagedPaths(repositoryRoot: string): ReadonlyArray<string> {
  const output = git(repositoryRoot, [
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
    "-z"
  ]);
  return output
    .toString("utf8")
    .split("\0")
    .filter((candidate) => candidate.length > 0);
}

function hasUnstagedChanges(repositoryRoot: string, relativePath: string): boolean {
  const result = spawnSync("git", ["diff", "--quiet", "--", relativePath], {
    cwd: repositoryRoot,
    stdio: "inherit"
  });
  if (result.status === 0) {
    return false;
  }
  if (result.status === 1) {
    return true;
  }
  throw new PreCommitError(
    `git could not inspect unstaged changes for ${relativePath} (exit ${result.status ?? "unknown"})`
  );
}

function ensureFormatter(repositoryRoot: string): void {
  const result = spawnSync("haxelib", ["list", "formatter"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  if (result.error && "code" in result.error && result.error.code === "ENOENT") {
    throw new PreCommitError(
      `haxelib is required to format staged Haxe files. Install Haxe 4.3.7 and formatter ${HAXE_FORMATTER_VERSION}.`
    );
  }
  const selectedVersion = result.stdout.match(/\[([^\]]+)\]/)?.[1];
  if (result.status !== 0 || selectedVersion !== HAXE_FORMATTER_VERSION) {
    throw new PreCommitError(
      `haxe-formatter ${HAXE_FORMATTER_VERSION} must be active for staged .hx files. Run: yarn haxelib install formatter ${HAXE_FORMATTER_VERSION} --quiet`
    );
  }
}

function formatStagedHaxe(
  repositoryRoot: string,
  stagedFiles: ReadonlyArray<string>
): void {
  const haxeFiles = stagedFiles.filter((relativePath) => relativePath.endsWith(".hx"));
  if (haxeFiles.length === 0) {
    return;
  }

  const partiallyStaged = haxeFiles.filter((relativePath) =>
    hasUnstagedChanges(repositoryRoot, relativePath)
  );
  if (partiallyStaged.length > 0) {
    const formattedPaths = partiallyStaged.map((relativePath) => `  - ${relativePath}`).join("\n");
    throw new PreCommitError(
      [
        "Cannot auto-format partially staged Haxe files without risking hidden edits:",
        formattedPaths,
        "Stage the complete file, or temporarily stash its unstaged edits, then commit again."
      ].join("\n")
    );
  }

  ensureFormatter(repositoryRoot);
  const existingFiles = haxeFiles.filter((relativePath) => {
    const absolutePath = path.join(repositoryRoot, relativePath);
    return existsSync(absolutePath) && lstatSync(absolutePath).isFile();
  });
  if (existingFiles.length === 0) {
    return;
  }

  console.log(`[pre-commit] Formatting ${existingFiles.length} staged Haxe file(s)...`);
  const formatterArgs = existingFiles.flatMap((relativePath) => [
    "-s",
    path.join(repositoryRoot, relativePath)
  ]);
  execFileSync("haxelib", ["run", "formatter", ...formatterArgs], {
    cwd: repositoryRoot,
    stdio: "inherit"
  });
  execFileSync("git", ["add", "--", ...existingFiles], {
    cwd: repositoryRoot,
    stdio: "inherit"
  });
}

/**
 * Protects the exact snapshot that Git is about to commit.
 *
 * Why: hosted gitleaks CI rejects leaked credentials only after a branch has
 * reached GitHub. This runner moves the first rejection before commit creation
 * while retaining CI as the full-history backstop.
 *
 * What: staged Haxe files are formatter-canonicalized and re-staged, then the
 * final Git index is scanned with the same pinned gitleaks owner used by CI.
 *
 * How: only paths in the index participate. A Haxe file with additional
 * working-tree edits is rejected before formatting because `git add` would
 * otherwise sweep those hidden edits into the commit.
 */
async function main(): Promise<void> {
  const repositoryRoot = repositoryRootFromArgs();
  const files = stagedPaths(repositoryRoot);
  formatStagedHaxe(repositoryRoot, files);

  console.log("[pre-commit] Scanning the final staged snapshot for secrets...");
  await scanWithGitleaks("staged", repositoryRoot);
  console.log("[pre-commit] OK");
}

try {
  await main();
} catch (error) {
  if (error instanceof PreCommitError) {
    console.error(`[pre-commit] ERROR: ${error.message}`);
  } else if (error instanceof Error) {
    console.error(`[pre-commit] ERROR: ${error.message}`);
  } else {
    console.error("[pre-commit] ERROR: pre-commit validation failed");
  }
  process.exitCode = 1;
}
