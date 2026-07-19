# Beads and linked Git worktrees

This guide explains how Genes keeps issue tracking convenient without letting
one Git worktree unexpectedly change another.

## The practical problem

Git worktrees give one repository several working directories. They have
separate branches, files, and staging indexes, but they share Git's common
repository data. Beads follows that shared repository and gives every worktree
the same live Dolt issue database.

That sharing is useful: an issue created in one worktree is immediately visible
from the others. It also means an automatic JSONL export has a surprising
destination. A hook started by a feature-worktree commit can discover the
database under the primary checkout and rewrite the primary
`.beads/issues.jsonl`, even though the feature commit did not intend to touch
the roadmap.

This happened in practice with Beads 1.0.4 while the primary checkout already
contained staged work. The database was not corrupted and no records were
lost, but the primary file gained an unexpected unstaged change. That is enough
to make a later commit or manual conflict resolution unsafe.

## Which copy is authoritative?

The two Beads representations have different jobs:

| Representation | Purpose | Shared between worktrees? |
| --- | --- | --- |
| Dolt database under `.beads/` | Live issues, dependencies, history, and coordination | Yes |
| `.beads/issues.jsonl` | Human-reviewable Git snapshot and fresh-checkout seed | It is a normal file on each Git branch |

The Dolt database is the live source of truth. The JSONL file is deliberately
published evidence. It does not contain all Dolt history or every Beads table,
so it must not be treated as a complete backup.

## Repository policy

Genes pins these settings in `.beads/config.yaml`:

```yaml
export.auto: false
export.git-add: false
```

The first setting prevents ordinary Beads commands and the pre-commit hook from
rewriting the tracked snapshot automatically. The second prevents Beads from
staging an export. Together they keep issue-database writes independent from a
feature worktree's Git commit.

Check the effective values when diagnosing a machine:

```bash
bd config get export.auto
bd config get export.git-add
```

Both commands must print `false`. Beads 1.1.0 or newer is recommended. After an
upgrade, reinstall the managed hooks and recheck the settings:

```bash
bd version
bd hooks install
bd config get export.auto
bd config get export.git-add
```

Do not hand-edit `.git/hooks/*` to encode this policy. Those files are generated
by Beads, shared by all linked worktrees, and may be replaced during an upgrade.

## Everyday issue work

Issue commands still work normally from any worktree:

```bash
bd ready
bd update genes-123 --status in_progress
bd close genes-123
```

They update the shared Dolt database. They should not modify or stage
`.beads/issues.jsonl`.

Feature commits and feature pushes should contain the feature itself. A Beads
status change is published afterward from primary `main`; this avoids combining
a shared tracker snapshot with a branch that may be rebased or discarded.

## Publishing the roadmap snapshot

After a feature has merged and its Bead status is final:

```bash
# Run from the primary checkout, on main.
git pull --rebase
yarn beads:export
git diff -- .beads/issues.jsonl
git add .beads/issues.jsonl
git commit -m "chore(beads): publish roadmap state"
git push
```

`yarn beads:export` is intentionally strict. Before invoking `bd export`, it
requires all of the following:

- the current directory is the primary worktree, not a linked worktree;
- the current branch is `main`;
- local `HEAD` equals the fetched `origin/main` reference;
- the primary checkout has no staged, unstaged, or untracked files;
- both automatic-export settings are explicitly disabled;
- neither `BEADS_DIR` nor `BEADS_DB` redirects discovery to another database.

The command exports regular issue records only. It does not use `--all`, because
that could publish infrastructure records or persistent memories that do not
belong in the roadmap snapshot. It refuses ambient `BEADS_DIR` and `BEADS_DB`
overrides so a one-off shell setting cannot publish another project's
database. It also verifies that Beads left the Git index unchanged, and never
stages or commits the result itself.

## Temporary containment on an incorrectly configured checkout

If either effective export setting is not `false`, do not make a feature
worktree commit until the configuration is repaired. When an urgent isolated
commit cannot wait, first run its normal tests manually, then use:

```bash
BD_EXPORT_AUTO=false BD_EXPORT_GIT_ADD=false git commit --no-verify
BD_EXPORT_AUTO=false BD_EXPORT_GIT_ADD=false git push --no-verify
```

This is containment, not the normal workflow. `--no-verify` skips every Git
hook, including unrelated useful checks, so the repository configuration and
managed hooks must still be repaired.

## Recovery after an unexpected export

An unexpected JSONL diff does not by itself mean the database is corrupt. Stop
before committing and separate the three states:

```bash
git status --short -- .beads/issues.jsonl
git hash-object .beads/issues.jsonl
git rev-parse :0:.beads/issues.jsonl
git diff -- .beads/issues.jsonl
git diff --cached -- .beads/issues.jsonl
bd show <important-issue-id> --json
```

- `git hash-object` identifies the working-file bytes.
- `git rev-parse :0:...` identifies the staged bytes.
- `bd show` checks the live database independently of the JSONL snapshot.

Do not reset, restore, or overwrite the file until the two diffs have been
reviewed and the unexpected lines are known. Preserve legitimate user edits and
remove only the export-owned change. Then confirm the working and staged hashes
have the expected relationship and that important database records still
resolve.

## Regression evidence

Run the focused integration test after changing Beads versions, hook behavior,
configuration, or this workflow:

```bash
yarn test:beads-worktrees
```

The test creates a disposable repository with a primary checkout and linked
worktree, initializes a real Beads database and managed hook, changes the shared
database, gives the primary snapshot different staged and unstaged bytes,
commits from the linked worktree, and verifies that both primary states remain
byte-identical. It then restores only the disposable fixture and proves that
the repository-owned export command works from clean primary `main` while
refusing linked and dirty contexts.

CI runs this test against verified upstream Beads 1.0.4 and 1.1.0 release
binaries. Their Linux archive hashes are pinned in `.github/workflows/ci.yml`,
so a hook or configuration change in either the incident version or recommended
version cannot silently remove this protection.

See also:

- [Beads configuration reference](https://github.com/gastownhall/beads/blob/main/docs/CONFIG.md)
- [Beads releases and upgrade notes](https://github.com/gastownhall/beads/releases)
