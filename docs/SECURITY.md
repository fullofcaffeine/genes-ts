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

OSV configuration lives in `.osv-scanner.toml`. Exceptions must be:

- narrow (package-specific),
- justified (include a reason),
- time-bounded (`effectiveUntil`), and
- reviewed regularly.
