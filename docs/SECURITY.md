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
