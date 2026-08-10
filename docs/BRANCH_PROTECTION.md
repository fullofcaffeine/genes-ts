# Main branch protection

`main` is protected by the active repository ruleset **Main branch quality
gate**. This is a GitHub repository setting, not merely a recommendation in
this file. Anyone with repository read access can inspect the rule at
<https://github.com/fullofcaffeine/genes-ts/rules>.

## What the rule guarantees

The ruleset targets only the default branch and has no bypass actors:

- **Require a pull request**: changes cannot be pushed directly to `main`.
- **Require status checks**: all six reviewed checks below must complete
  successfully on the pull-request head.
- **Require branches to be up to date**: the checks must cover the latest
  `main`, not an older merge base.
- **Block force pushes**: published `main` history cannot be rewritten.
- **No bypass actors**: the rule applies to repository administrators too.

The pull request itself does not require an approving review. Review remains
strongly encouraged, but a mandatory approval would prevent a single
maintainer from landing an independently reviewed maintenance change. The
ruleset allows the repository's enabled merge, squash, and rebase methods.

## Required checks

The exact status-check names are:

- `Analyze (JavaScript)`
- `Secrets (gitleaks)`
- `Vulnerabilities (OSV)`
- `Classic Genes (stable, ubuntu-latest)`
- `Classic Genes (nextLts, ubuntu-latest)`
- `genes-ts (TS output + todoapp E2E)`

Each required check is pinned to the GitHub Actions application rather than
accepting a same-named status from an arbitrary integration.

`Haxe preview (non-blocking)`, `Classic Genes (stable, macos-latest)`,
`genes-ts smoke (Node latest LTS)`, the Beads worktree matrix, and Dependency
Review remain useful signals but are not merge requirements. Preview Haxe and
macOS intentionally retain their workflow-level advisory policy.

## How protected main can still release

The final **Release exact CI-tested commit** job does not push to `main`.
Semantic-release creates a `vX.Y.Z` tag on the exact commit whose same-run CI
graph just passed—including the hosted CodeQL job—while version metadata is
injected only into temporary package staging. CodeQL is part of the same
workflow specifically so publication can depend on its exact-SHA result.
This preserves branch protection and avoids a second, untested release commit.

Version tags have a separate active ruleset named
**Immutable semantic version tags**. It targets compiler `refs/tags/v*` tags
and tooling `refs/tags/tooling-v*` tags, and blocks deletion and
non-fast-forward updates. Published GitHub Releases are also immutable, which
locks their notes and assets. Together these controls mean a released version
cannot later be made to identify different source or bytes.

Audit them with a maintainer credential that has repository
`Administration: read`:

```bash
node scripts/release/verify-host-controls.cjs fullofcaffeine/genes-ts
```

GitHub does not allow a workflow `GITHUB_TOKEN` to request Administration
permission. The release job therefore retains only `contents: write` and
requires the published Release itself to report `immutable: true`; it does not
embed a long-lived administrator token merely to re-read settings. See
[Releasing](RELEASING.md) for this permission boundary, artifact verification,
and partial-publication recovery.

## Why CI has no workflow path filter

GitHub leaves required checks pending when their entire workflow is skipped by
a path filter. Roadmap-only pull requests change `.beads/issues.jsonl`, so the
main compiler workflow must start for those pull requests as well as source
changes. This costs a full gate for a roadmap publication, but it keeps one
honest rule: every commit entering `main` has the same compiler and security
evidence.

The fast local structural check protects this relationship:

```bash
yarn test:main-protection-policy
```

It verifies workflow triggers, exact required-check names, and the advisory
lanes. It cannot prove a GitHub repository setting, so remote verification is
also required.

## Verify the live rule

List the repository rulesets and inspect the active rule:

```bash
gh api repos/fullofcaffeine/genes-ts/rulesets \
  --jq '.[] | {id, name, enforcement, target}'

RULESET_ID="$(
  gh api repos/fullofcaffeine/genes-ts/rulesets \
    --jq '.[] | select(.name == "Main branch quality gate") | .id'
)"
gh api "repos/fullofcaffeine/genes-ts/rulesets/${RULESET_ID}"
gh api repos/fullofcaffeine/genes-ts/rules/branches/main
```

The detailed response must show:

- `enforcement: "active"`;
- `~DEFAULT_BRANCH` as the only included ref condition;
- an empty `bypass_actors` array;
- `pull_request`, `required_status_checks`, and `non_fast_forward` rules;
- `strict_required_status_checks_policy: true`; and
- the six contexts above with GitHub Actions integration ID `15368`.

Inspect the version-tag rule and immutable-release setting separately. This
command requires repository `Administration: read`:

```bash
node scripts/release/verify-host-controls.cjs fullofcaffeine/genes-ts
```

GitHub's rule-suite API records real pass/fail evaluations. Use it when
auditing a rejected direct update or a pull request whose required check
failed; do not weaken the live rule merely to manufacture evidence.

## Changing or recovering the rule

Treat a ruleset edit like compiler infrastructure. A required-check rename
needs an overlap rollout because GitHub waits forever for a required context
that the workflow no longer emits:

1. In one pull request, emit the old and new check contexts together. Keep the
   old required name in this guide and the structural test for that PR.
2. After both contexts succeed on `main`, add the new context to the ruleset
   while retaining the old one.
3. In a second pull request, update this guide and the structural test to name
   the new context, but keep emitting both contexts. Merge it while both remain
   required and available.
4. Remove the old context from the ruleset, leaving the new context required.
5. In a third pull request, remove the old workflow context now that no active
   rule waits for it.
6. Query the API after each settings change and confirm a normal pull request
   can still merge.

For a policy change that does not rename or remove a context, update this guide
and the structural test in one pull request, let the existing required checks
prove it, apply the matching setting, then query the API again.

For emergency diagnosis, disabling is safer and more reversible than deleting
the rule:

```bash
gh api --method PUT \
  "repos/fullofcaffeine/genes-ts/rulesets/${RULESET_ID}" \
  -f enforcement=disabled
```

Re-enable it with `-f enforcement=active` after the cause is corrected. A
disabled rule is not protection, so document the incident and restore active
enforcement before ordinary development resumes. Never add a permanent bypass
actor to make a failing check or direct-push workflow convenient.

See also:

- [GitHub's ruleset overview](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [Available rules and strict status-check behavior](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [Testing strategy](TESTING_STRATEGY.md)
- [Beads roadmap publication](BEADS_WORKTREES.md#publishing-the-roadmap-snapshot)
- [Pinned toolchains](TOOLCHAINS.md)
