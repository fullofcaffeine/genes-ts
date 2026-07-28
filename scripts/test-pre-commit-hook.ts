import { ok, strictEqual } from "node:assert";
import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const preCommitRunner = path.join(scriptDirectory, "pre-commit.js");
const hookInstaller = path.join(scriptDirectory, "install-git-hooks.js");
const trackedHookRunner = path.join(repositoryRoot, "scripts", "hooks", "pre-commit");
const genesMarker = "# --- BEGIN GENES PRE-COMMIT v1 ---";
const beadsMarker = "# --- BEGIN BEADS INTEGRATION";

function cleanEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.BEADS_DIR;
  delete environment.BEADS_DB;
  environment.BD_NON_INTERACTIVE = "1";
  environment.BEADS_HOOK_TIMEOUT = "30";
  return environment;
}

function run(
  cwd: string,
  command: string,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv
): string {
  return execFileSync(command, [...args], {
    cwd,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function git(
  cwd: string,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv
): string {
  return run(cwd, "git", args, environment);
}

function attemptCommit(
  cwd: string,
  message: string,
  environment: NodeJS.ProcessEnv
): SpawnSyncReturns<string> {
  return spawnSync("git", ["commit", "-m", message], {
    cwd,
    env: environment,
    encoding: "utf8"
  });
}

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function writeExecutable(file: string, contents: string): void {
  writeFileSync(file, contents);
  chmodSync(file, 0o755);
}

/**
 * Exercises the real Git hook boundary in a disposable repository.
 *
 * Why: static inspection cannot prove that Beads upgrades preserve the Genes
 * section, that Git invokes both owners from a linked worktree, or that a
 * rejected commit leaves the index intact.
 *
 * What: the fixture installs the actual marked hook, invokes the compiled
 * staged runner, formats a Haxe file, rejects a generated credential, and
 * checks the partial-staging guard.
 *
 * How: the fixture keeps secrets out of this repository by assembling the
 * detector token only inside the disposable checkout. Its hook wrapper calls
 * the already-built runner directly so this test validates hook behavior
 * without recursively compiling the test suite from inside `git commit`.
 */
function verifyPreCommitBoundary(): void {
  const trackedRunnerSource = readFileSync(trackedHookRunner, "utf8");
  ok((statSync(trackedHookRunner).mode & 0o111) !== 0,
    "tracked pre-commit runner is not executable");
  ok(trackedRunnerSource.includes("exec yarn precommit:run"),
    "tracked pre-commit runner does not delegate to the package-script owner");

  const environment = cleanEnvironment();
  const root = mkdtempSync(path.join(tmpdir(), "genes-pre-commit-"));
  const primary = path.join(root, "primary");
  const linked = path.join(root, "linked");
  const realBd = run(repositoryRoot, "sh", ["-c", "command -v bd"], environment);
  mkdirSync(primary);

  try {
    git(primary, ["init", "-b", "main"], environment);
    git(primary, ["config", "user.name", "Genes Hook Test"], environment);
    git(primary, ["config", "user.email", "genes-hook@example.invalid"], environment);

    run(
      primary,
      "bd",
      [
        "init",
        "--non-interactive",
        "--role",
        "maintainer",
        "--skip-agents",
        "--skip-hooks",
        "--prefix",
        "hooks"
      ],
      environment
    );
    const beadsConfig = path.join(primary, ".beads", "config.yaml");
    appendFileSync(beadsConfig, "\nexport.auto: false\nexport.git-add: false\n");

    copyFileSync(path.join(repositoryRoot, "hxformat.json"), path.join(primary, "hxformat.json"));
    const runnerDirectory = path.join(primary, "scripts", "hooks");
    mkdirSync(runnerDirectory, { recursive: true });
    writeExecutable(
      path.join(runnerDirectory, "pre-commit"),
      [
        "#!/usr/bin/env sh",
        "set -eu",
        `exec "${process.execPath}" "${preCommitRunner}" --repo-root "$(git rev-parse --show-toplevel)"`,
        ""
      ].join("\n")
    );
    writeFileSync(path.join(primary, "README.md"), "pre-commit fixture\n");
    git(primary, ["add", "."], environment);
    git(primary, ["commit", "--no-verify", "-m", "test: initialize fixture"], environment);

    const commonGitDirectory = git(
      primary,
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      environment
    );
    const hookPath = path.join(commonGitDirectory, "hooks", "pre-commit");
    const userTrace = path.join(root, "user-hook.trace");
    writeExecutable(
      hookPath,
      [
        "#!/usr/bin/env sh",
        `printf '%s\\n' user-hook >> "${userTrace}"`,
        ""
      ].join("\n")
    );

    run(
      primary,
      process.execPath,
      [hookInstaller, "--repo-root", primary, "--beads-bin", realBd],
      environment
    );
    let installedHook = readFileSync(hookPath, "utf8");
    strictEqual(count(installedHook, genesMarker), 1, "Genes hook marker is not unique");
    strictEqual(count(installedHook, beadsMarker), 1, "Beads hook marker is not unique");
    ok(installedHook.includes("user-hook"), "pre-existing hook content was discarded");
    ok((statSync(hookPath).mode & 0o111) !== 0, "installed hook is not executable");

    run(
      primary,
      process.execPath,
      [hookInstaller, "--repo-root", primary, "--beads-bin", realBd],
      environment
    );
    run(primary, "bd", ["hooks", "install", "--chain"], environment);
    installedHook = readFileSync(hookPath, "utf8");
    strictEqual(count(installedHook, genesMarker), 1, "reinstall duplicated Genes hook");
    strictEqual(count(installedHook, beadsMarker), 1, "reinstall duplicated Beads hook");
    ok(installedHook.includes("user-hook"), "reinstall discarded user hook content");

    const realHaxelib = run(
      repositoryRoot,
      "sh",
      ["-c", "command -v haxelib"],
      environment
    );
    const shimDirectory = path.join(root, "bin");
    const beadsTrace = path.join(root, "beads-hook.trace");
    mkdirSync(shimDirectory);
    writeExecutable(
      path.join(shimDirectory, "bd"),
      [
        "#!/usr/bin/env sh",
        `printf '%s\\n' "$*" >> "${beadsTrace}"`,
        `exec "${realBd}" "$@"`,
        ""
      ].join("\n")
    );
    writeExecutable(
      path.join(shimDirectory, "haxelib"),
      [
        "#!/usr/bin/env sh",
        "set -eu",
        // Lix's haxelib shim resolves the selected Haxe installation from the
        // current project. Keep that real Genes project context while the
        // disposable repository supplies only the files needed by this hook
        // test; absolute formatter input paths still target the fixture.
        `cd "${repositoryRoot}"`,
        `exec "${realHaxelib}" "$@"`,
        ""
      ].join("\n")
    );
    const tracedEnvironment = {
      ...environment,
      PATH: `${shimDirectory}${path.delimiter}${environment.PATH ?? ""}`
    };

    writeFileSync(path.join(primary, "README.md"), "ordinary commit\n");
    git(primary, ["add", "README.md"], tracedEnvironment);
    const ordinary = attemptCommit(primary, "test: ordinary commit", tracedEnvironment);
    strictEqual(ordinary.status, 0, ordinary.stderr);
    ok(readFileSync(userTrace, "utf8").includes("user-hook"));
    ok(
      readFileSync(beadsTrace, "utf8").includes("hooks run pre-commit"),
      "Beads pre-commit owner did not execute"
    );

    const generatedSecret = `${["gh", "p_"].join("")}${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8".slice(0, 36)}`;
    writeFileSync(path.join(primary, "credentials.txt"), `${generatedSecret}\n`);
    git(primary, ["add", "credentials.txt"], tracedEnvironment);
    const headBeforeSecret = git(primary, ["rev-parse", "HEAD"], tracedEnvironment);
    const secretCommit = attemptCommit(primary, "test: leaked credential", tracedEnvironment);
    ok(secretCommit.status !== 0, "credential commit unexpectedly succeeded");
    strictEqual(git(primary, ["rev-parse", "HEAD"], tracedEnvironment), headBeforeSecret);
    ok(
      `${secretCommit.stdout}${secretCommit.stderr}`.toLowerCase().includes("leak"),
      "credential rejection did not report gitleaks"
    );
    git(primary, ["restore", "--staged", "credentials.txt"], tracedEnvironment);
    rmSync(path.join(primary, "credentials.txt"));

    const haxePath = path.join(primary, "Main.hx");
    const unformattedHaxe = 'class Main{static function main(){trace("ok");}}\n';
    writeFileSync(haxePath, unformattedHaxe);
    git(primary, ["add", "Main.hx"], tracedEnvironment);
    const haxeCommit = attemptCommit(primary, "test: format Haxe", tracedEnvironment);
    strictEqual(haxeCommit.status, 0, haxeCommit.stderr);
    const formattedHaxe = readFileSync(haxePath, "utf8");
    ok(formattedHaxe !== unformattedHaxe, "staged Haxe file was not formatted");
    run(
      primary,
      "haxelib",
      ["run", "formatter", "-s", haxePath, "--check"],
      tracedEnvironment
    );

    writeFileSync(
      haxePath,
      `${formattedHaxe.trimEnd()}\n// staged change\n`
    );
    git(primary, ["add", "Main.hx"], tracedEnvironment);
    appendFileSync(haxePath, "// unstaged change\n");
    const indexBeforePartial = git(
      primary,
      ["rev-parse", ":0:Main.hx"],
      tracedEnvironment
    );
    const workingBeforePartial = git(
      primary,
      ["hash-object", "Main.hx"],
      tracedEnvironment
    );
    const partialCommit = attemptCommit(primary, "test: partial Haxe", tracedEnvironment);
    ok(partialCommit.status !== 0, "partially staged Haxe commit unexpectedly succeeded");
    ok(
      `${partialCommit.stdout}${partialCommit.stderr}`.includes("partially staged Haxe"),
      "partial-staging rejection was not actionable"
    );
    strictEqual(
      git(primary, ["rev-parse", ":0:Main.hx"], tracedEnvironment),
      indexBeforePartial,
      "partial-staging rejection changed the Git index"
    );
    strictEqual(
      git(primary, ["hash-object", "Main.hx"], tracedEnvironment),
      workingBeforePartial,
      "partial-staging rejection changed the working file"
    );
    git(primary, ["restore", "--staged", "Main.hx"], tracedEnvironment);
    git(primary, ["restore", "Main.hx"], tracedEnvironment);

    writeFileSync(haxePath, unformattedHaxe);
    git(primary, ["add", "Main.hx"], tracedEnvironment);
    const missingFormatterEnvironment = {
      ...environment,
      PATH: "/usr/bin:/bin"
    };
    const missingFormatter = spawnSync(
      process.execPath,
      [preCommitRunner, "--repo-root", primary],
      {
        cwd: primary,
        env: missingFormatterEnvironment,
        encoding: "utf8"
      }
    );
    ok(missingFormatter.status !== 0, "missing formatter unexpectedly passed");
    ok(
      `${missingFormatter.stdout}${missingFormatter.stderr}`.includes("haxelib is required"),
      "missing formatter did not report the prerequisite"
    );

    const wrongFormatterBin = path.join(root, "wrong-formatter-bin");
    mkdirSync(wrongFormatterBin);
    writeExecutable(
      path.join(wrongFormatterBin, "haxelib"),
      [
        "#!/usr/bin/env sh",
        "printf '%s\\n' 'formatter: [9.9.9]'",
        ""
      ].join("\n")
    );
    const wrongFormatter = spawnSync(
      process.execPath,
      [preCommitRunner, "--repo-root", primary],
      {
        cwd: primary,
        env: {
          ...environment,
          PATH: `${wrongFormatterBin}:/usr/bin:/bin`
        },
        encoding: "utf8"
      }
    );
    ok(wrongFormatter.status !== 0, "wrong formatter version unexpectedly passed");
    ok(
      `${wrongFormatter.stdout}${wrongFormatter.stderr}`.includes(
        "haxe-formatter 1.18.0 must be active"
      ),
      "wrong formatter version did not report the pinned prerequisite"
    );
    git(primary, ["restore", "--staged", "Main.hx"], tracedEnvironment);
    git(primary, ["restore", "Main.hx"], tracedEnvironment);

    git(primary, ["worktree", "add", "-b", "linked", linked, "main"], tracedEnvironment);
    writeFileSync(path.join(linked, "linked-credentials.txt"), `${generatedSecret}\n`);
    git(linked, ["add", "linked-credentials.txt"], tracedEnvironment);
    const linkedCommit = attemptCommit(linked, "test: linked secret", tracedEnvironment);
    ok(linkedCommit.status !== 0, "linked-worktree credential commit unexpectedly passed");
    ok(
      `${linkedCommit.stdout}${linkedCommit.stderr}`.toLowerCase().includes("leak"),
      "linked-worktree rejection did not run gitleaks"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

verifyPreCommitBoundary();
console.log("pre-commit-hook:ok");
