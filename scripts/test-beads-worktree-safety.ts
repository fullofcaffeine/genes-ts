import { ok, strictEqual, throws } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import {
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
  exportBeadsSnapshot,
  validateBeadsSnapshotContext
} from "./export-beads-snapshot.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");

function cleanEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.BEADS_DIR;
  delete env.BEADS_DB;
  delete env.BD_EXPORT_AUTO;
  delete env.BD_EXPORT_GIT_ADD;
  env.BD_NON_INTERACTIVE = "1";
  env.BEADS_HOOK_TIMEOUT = "30";
  return env;
}

function run(
  cwd: string,
  command: string,
  args: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv
): string {
  return execFileSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function git(cwd: string, args: ReadonlyArray<string>, env: NodeJS.ProcessEnv): string {
  return run(cwd, "git", args, env);
}

function bd(cwd: string, args: ReadonlyArray<string>, env: NodeJS.ProcessEnv): string {
  return run(cwd, "bd", args, env);
}

function snapshotHashes(primary: string, env: NodeJS.ProcessEnv): readonly [string, string] {
  return [
    git(primary, ["hash-object", ".beads/issues.jsonl"], env),
    git(primary, ["rev-parse", ":0:.beads/issues.jsonl"], env)
  ];
}

function assertRepositoryConfiguration(): void {
  const config = readFileSync(path.join(repoRoot, ".beads/config.yaml"), "utf8");
  ok(/^export\.auto:\s*false\s*$/m.test(config), "export.auto must stay disabled");
  ok(
    /^export\.git-add:\s*false\s*$/m.test(config),
    "export.git-add must stay disabled"
  );
}

/**
 * Reproduces the cross-worktree boundary with a real disposable Beads database.
 *
 * Why: checking two YAML lines cannot prove that a managed Git hook respects
 * them. This fixture exercises the same shared-database topology that once
 * dirtied the Genes primary checkout.
 *
 * What/How: a primary checkout owns the database and tracked snapshot; a linked
 * worktree changes the database and commits an unrelated file through the real
 * Beads hook. Exact Git blob IDs prove that neither the primary working file nor
 * its staging index moved, while `bd show` proves the new record was retained.
 */
function assertRealWorktreeHookBoundary(): void {
  const env = cleanEnvironment();
  const bdVersion = spawnSync("bd", ["version"], { env, encoding: "utf8" });
  if (bdVersion.status !== 0) {
    throw new Error("The focused Beads worktree test requires bd on PATH");
  }

  const root = mkdtempSync(path.join(tmpdir(), "genes-beads-worktree-"));
  const remote = path.join(root, "remote.git");
  const primary = path.join(root, "primary");
  const linked = path.join(root, "linked");
  mkdirSync(remote);

  try {
    git(remote, ["init", "--bare"], env);
    git(root, ["clone", remote, primary], env);
    git(primary, ["checkout", "-b", "main"], env);
    git(primary, ["config", "user.name", "Genes Beads Safety Test"], env);
    git(primary, ["config", "user.email", "genes-beads-safety@example.invalid"], env);

    bd(primary, [
      "init",
      "--non-interactive",
      "--role",
      "maintainer",
      "--skip-agents",
      "--skip-hooks",
      "--prefix",
      "safety"
    ], env);
    const configEnv = {
      ...env,
      BD_EXPORT_AUTO: "false",
      BD_EXPORT_GIT_ADD: "false"
    };
    bd(primary, ["config", "set", "export.auto", "false"], configEnv);
    bd(primary, ["config", "set", "export.git-add", "false"], configEnv);
    bd(primary, ["hooks", "install"], configEnv);
    bd(primary, ["create", "Baseline issue", "--priority", "2"], env);
    bd(primary, ["export", "-o", path.join(primary, ".beads/issues.jsonl")], env);

    writeFileSync(path.join(primary, "README.md"), "temporary safety fixture\n");
    git(primary, ["add", "."], env);
    git(primary, ["commit", "-m", "test: initialize safety fixture"], env);
    git(primary, ["push", "-u", "origin", "main"], env);

    validateBeadsSnapshotContext(primary);
    git(primary, ["worktree", "add", "-b", "feature", linked, "main"], env);
    throws(
      () => exportBeadsSnapshot(linked),
      /only from the primary Git worktree/
    );

    const created = bd(linked, ["create", "Shared worktree issue", "--priority", "2"], env);
    const issueId = created.match(/safety-[a-z0-9]+/)?.[0];
    ok(issueId, `Could not read the created issue ID from: ${created}`);

    const beforeCommit = snapshotHashes(primary, env);
    writeFileSync(path.join(linked, "feature.txt"), "feature-only change\n");
    git(linked, ["add", "feature.txt"], env);
    git(linked, ["commit", "-m", "test: commit from linked worktree"], env);
    const afterCommit = snapshotHashes(primary, env);
    strictEqual(afterCommit[0], beforeCommit[0], "primary working snapshot changed");
    strictEqual(afterCommit[1], beforeCommit[1], "primary staged snapshot changed");

    const committedPaths = git(linked, ["show", "--pretty=format:", "--name-only", "HEAD"], env)
      .split(/\r?\n/)
      .filter(Boolean);
    strictEqual(committedPaths.join(","), "feature.txt");
    ok(bd(primary, ["show", issueId, "--json"], env).includes(issueId));

    exportBeadsSnapshot(primary);
    const afterPublication = snapshotHashes(primary, env);
    ok(
      afterPublication[0] !== beforeCommit[0],
      "deliberate publication did not refresh the primary working snapshot"
    );
    strictEqual(
      afterPublication[1],
      beforeCommit[1],
      "deliberate publication staged the snapshot"
    );
    ok(readFileSync(path.join(primary, ".beads/issues.jsonl"), "utf8").includes(issueId));

    throws(
      () => validateBeadsSnapshotContext(primary),
      /primary checkout must be completely clean/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

assertRepositoryConfiguration();
assertRealWorktreeHookBoundary();
console.log("beads-worktree-safety:ok (real shared DB + managed hook + fail-closed export)");
