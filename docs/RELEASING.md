# Releasing (genes-ts)

genes-ts uses **semantic-release** to maintain:

- Semver tags + GitHub Releases
- `CHANGELOG.md`
- Version syncing between `package.json` and `haxelib.json`
- A `submit.zip` artifact attached to each GitHub Release

## Prerequisites

- Merge to `main` using **Conventional Commits** (or at least `feat:` / `fix:` / `perf:`).
- CI must be green.

## How releases happen

- GitHub Actions workflow `Release` runs after `CI` succeeds on `main`.
- `semantic-release` determines the next version from commit messages:
  - `fix:` → patch
  - `feat:` → minor
  - `feat!:` / `fix!:` or `BREAKING CHANGE:` → major
- During `prepare`, we:
  - sync versions via `scripts/release/sync-versions.ts`
  - build `submit.zip` via `yarn submit:zip`
- The release workflow then creates a GitHub Release and uploads `submit.zip`.

## Local checks

Before merging:

```bash
yarn test:ci
```

To verify version files are in sync:

```bash
yarn test:versions
```

