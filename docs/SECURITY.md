# Security (genes-ts)

## Secret scanning (local + CI)

This repo runs a secrets scan using **gitleaks** (pinned version):

- Locally: `yarn test:secrets`
- In CI: GitHub Actions job `secrets` (runs on every push/PR)

Why gitleaks (vs GitGuardian)?
- Works without requiring a hosted account or repository-level secret for scanning.
- Easy to run locally with the exact same version as CI.

### What is scanned

The scan runs against the git repository (commit history + current tree). In CI,
the workflow checks out with `fetch-depth: 0` so history is available.

### Pre-commit boundary

CI can prevent a leaked credential from merging, but it cannot prevent the
commit or branch from reaching GitHub in the first place. Install the local,
repository-owned pre-commit boundary once per clone:

```bash
yarn haxelib install formatter 1.18.0 --quiet
yarn hooks:install
```

The hook performs two ordered operations:

1. It runs haxe-formatter on complete staged `.hx` files and re-stages the
   formatted result. If a staged Haxe file also contains unstaged edits, the
   hook stops before changing either the index or working file; stage the full
   file or temporarily stash those edits.
2. It scans the resulting Git index with the same pinned gitleaks executable
   used by `yarn test:secrets`.

The shared scanner owner verifies the downloaded gitleaks 8.18.2 release
archive against its pinned upstream SHA-256 before caching the executable. A
missing or mismatched archive fails closed.

This is deliberately a staged-snapshot scan: unrelated working files do not
participate in the commit and are not inspected. The required CI command still
scans complete repository history after push, so the two checks are
complementary rather than interchangeable.

The installer does not run during `yarn install`; changing Git hooks is an
explicit contributor action. It asks Beads to install/update its managed
section, then writes only a separately marked Genes section. Beads upgrades
preserve that section. Do not hand-edit `.git/hooks/pre-commit`.

Use these checks when changing hook, formatter, or scanner behavior:

```bash
yarn test:precommit-hook
yarn test:secrets
```

`test:precommit-hook` uses a disposable repository and linked worktree to prove
installation idempotence, Beads coexistence, staged Haxe formatting, partial
staging preservation, secret rejection, and fail-closed missing prerequisites.
`git commit --no-verify` bypasses every local hook; it is an emergency escape
hatch, not a substitute for either command.

### Handling false positives

If a detection is a false positive, prefer fixing it by:
1) removing the suspicious-looking value, or
2) rewriting test fixtures to avoid “secret-like” strings.

If you must ignore a finding, use gitleaks’ ignore mechanisms (baseline or
ignore file) and document why. Keep ignores narrow and reviewed.

## Dependency vulnerability scanning (local + CI)

This repo runs a dependency vulnerability scan using **OSV-Scanner** (pinned
version):

- Locally: `yarn test:vulns`
- In CI: GitHub Actions job `vulns` (runs on every push/PR)

The command scans both the repository's main `yarn.lock` and the focused CSS
Modules tracer's npm lockfile. The tracer uses a separate package only to run a
real pinned CSS processor and loader in tests; keeping its lockfile in the same
vulnerability check prevents that test-only dependency tree from becoming an
unreviewed gap.

### Exceptions / ignores

OSV configuration lives in `.osv-scanner.toml`. Upgrade the affected package
whenever a fixed release is compatible with the repository. An exception is
appropriate only when the reported vulnerable feature is provably outside the
repository's dependency usage and no compatible fixed release is available.

Prefer an `[[IgnoredVulns]]` entry for one advisory ID. This keeps OSV checking
the same package for every other current or future advisory. Use
`ignoreUntil = YYYY-MM-DD`, include the exact unused feature or unreachable
code path in `reason`, and create a Bead that owns removal before that date.

A `[[PackageOverrides]]` entry is broader because it can suppress every
vulnerability reported for a matching package. Use it only when the package as
a whole is outside the repository's executable or publication boundary. Such
an entry uses `effectiveUntil = YYYY-MM-DD` and must explain that boundary.

After adding or renewing either kind of exception, run:

```bash
yarn test:vulns
yarn test:ci
```

The scan output must name the filtered advisory and repeat the reason. This
makes a passing result reviewable: it shows which risk was excluded instead of
silently treating the entire dependency as safe.
