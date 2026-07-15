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
- `Classic Genes (stable, ubuntu-latest)`
- `Classic Genes (nextLts, ubuntu-latest)`
- `genes-ts (TS output + todoapp E2E)`
- `Analyze (JavaScript)` (CodeQL)

Optional (PR-only):

- `Dependency Review`

Do not require `Haxe preview (non-blocking)` or the macOS classic signal. Their
workflow-level `continue-on-error` policy is intentional. Exact versions come
from `config/toolchains.json`; see `TOOLCHAINS.md`.
