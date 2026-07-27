# Releasing genes-ts and `@genes-ts/tooling`

The compiler/Haxelib package and the framework-neutral npm tooling package have
independent release identities. Releasing one never releases, tags, or changes
the version of the other.

## Compiler and Haxelib release

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

The compiler workflow does not publish `@genes-ts/tooling`.

## Framework-neutral tooling npm release

`tooling/package.json` owns the independent `@genes-ts/tooling` SemVer. Hosts
such as NextJsHx, WordPressHx/Gutenberg, and other Haxe-to-JavaScript or
Haxe-to-TypeScript projects consume this package by immutable npm identity; they
must not depend on a sibling checkout or Git branch.

An ordinary merge never publishes tooling. Publication is available only
through the manual **Release tooling npm package** workflow. Before its first
OIDC use, repository administrators must configure:

- npm trusted publishing for this repository and the
  `.github/workflows/release-tooling.yml` workflow;
- a protected GitHub environment named `tooling-npm-production`, with required
  reviewers and no unreviewed deployment branches;
- branch protection on `main`, including the normal CI and security checks.

npm currently permits trusted-publisher configuration only after a package
exists. `@genes-ts/tooling` is not yet published, so version `0.1.0` requires a
one-time bootstrap by an authorized maintainer. That bootstrap must publish the
exact tarball produced and verified by `yarn test:tooling-package`, use a
narrowly scoped npm credential with 2FA/provenance from a GitHub-hosted runner,
and retain the same receipt/SBOM/downloaded-byte evidence. Immediately
afterward, configure `release-tooling.yml` as the sole trusted publisher,
disallow traditional publish tokens in the npm package settings, and revoke
the bootstrap credential. Do not add a permanent token fallback to the normal
workflow.

The operator supplies all three workflow inputs:

```text
version: 0.1.0
commit: <exact 40-character commit currently at origin/main>
authorization: publish @genes-ts/tooling@0.1.0 from <same commit>
```

The workflow checks that the selected commit is still `origin/main`, that the
package version is exact, and that the checkout is clean. It then:

1. reruns the full repository gate;
2. packs the npm package twice and proves byte-for-byte deterministic SHA-512
   integrity and a reviewed file inventory;
3. installs that tarball in a clean project, type-checks every code subpath, and
   imports every code and conformance-vector subpath at runtime;
4. creates a deterministic release receipt and SPDX 2.3 SBOM;
5. publishes those exact tarball bytes with npm provenance;
6. downloads the immutable registry package, compares it byte-for-byte with the
   reviewed tarball, and repeats the clean-consumer check;
7. retains the receipt, SBOM, pack inventory, and registry metadata as workflow
   evidence.

Local release-contract checks do not publish:

```bash
yarn test:tooling-release-workflow
yarn test:tooling-package
```

`yarn --cwd tooling pack:check` is the package-scoped equivalent.

### Version and changelog policy

- Change `tooling/package.json` and `tooling/CHANGELOG.md` together in the
  reviewed release-preparation pull request.
- Use SemVer for the public exports, runtime behavior, and versioned
  conformance protocols. A breaking change to an existing subpath or protocol
  requires a major version; a new backward-compatible subpath is minor; a
  compatible correction is patch.
- Do not reuse or overwrite an npm version. If publication succeeds but a later
  verification step fails, deprecate the bad version with an actionable npm
  message, fix forward under a new version, and preserve the failed workflow
  evidence. npm package bytes are immutable and are not rolled back.
- Do not run the compiler semantic-release workflow as part of tooling
  recovery. The two release lines remain independent.

Publishing or deprecating a package is an external mutation and always requires
explicit release authority. Merging release-contract code is not that
authority.
