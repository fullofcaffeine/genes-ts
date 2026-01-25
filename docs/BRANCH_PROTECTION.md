# Branch protection (recommended)

For `main`, enable branch protection with:

- Require PRs (no direct pushes)
- Require approvals (your preference)
- Require status checks to pass
- Require branches to be up to date before merging

## Suggested required checks

From GitHub Actions:

- `Secrets (gitleaks)`
- `Vulnerabilities (OSV)`
- `Classic Genes (Haxe 4.3.7)`
- `genes-ts (TS output + todoapp E2E)`
- `Analyze (JavaScript)` (CodeQL)

Optional (PR-only):

- `Dependency Review`
