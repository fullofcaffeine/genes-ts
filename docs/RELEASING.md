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
- The `tooling` scope is deliberately excluded: `feat(tooling):`,
  `fix(tooling):`, and breaking `tooling` commits never create a compiler tag
  or compiler release. They belong to the independently versioned
  `@genes-ts/tooling` package described below.
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

## Framework-neutral tooling distribution (npm deferred)

`tooling/package.json` owns the independent `@genes-ts/tooling` SemVer. The
package is optional host infrastructure; Genes compilation, generated
applications, and ts2hx do not depend on it. It is currently unpublished, and
no checked-in Genes workflow requires a registry copy.

During repository development, use the workspace package or the deterministic
tarball proved by `yarn test:tooling-package`. An external experiment may build
and install one exact 40-character Git commit with npm 11.18.0's
`#<commit>::path:tooling` selector. The subpackage's pinned build-only
dependencies and `prepare` script produce its untracked `dist/` tree during
installation. A plain GitHub dependency without `::path:tooling` selects the
repository root package instead. If durable prebuilt GitHub-only distribution
is needed before npm, publish a reviewed `.tgz` as an immutable,
checksum-documented GitHub Release asset.

npm 10.9.4 is explicitly unsupported for this Git-subdirectory path: it parses
the selector but installs the repository root. Use the deterministic tarball
path when npm 11.18.0 is unavailable or dependency build scripts are disabled.

npm remains a possible future distribution channel when a concrete independent
host is ready to adopt a reviewed public version. It is not required merely
because the package exists. See [`../tooling/README.md`](../tooling/README.md)
for the package boundary, examples, and pre-publication workflows.

An ordinary merge never publishes tooling. Publication is available only
through the manual **Release tooling npm package** workflow. Before its first
OIDC use, repository administrators must configure:

- npm trusted publishing for this repository and the
  `.github/workflows/release-tooling.yml` workflow;
- a protected GitHub environment named `tooling-npm-production`, with required
  reviewers, self-review disabled, administrator bypass disabled, and no
  unreviewed deployment branches;
- branch protection on `main`, including the normal CI and security checks.

These are not ceremonial settings. The workflow can request a short-lived npm
publishing identity through OpenID Connect (OIDC), so the workflow code and the
human approval boundary together decide who can publish. Every third-party
action in both release-capable workflows is therefore pinned to a full,
reviewed commit SHA. A tag such as `actions/checkout@v6` is readable but
mutable; the tag owner can move it after our review. The nearby `# v6.1.0`
comment retains the understandable release name and lets Dependabot propose
future SHA rotations.

The environment policy is checked twice:

1. normal CI reads GitHub's public environment API and compares it with
   `config/tooling-release-environment-policy.json`;
2. the release job repeats the same check before setting up the release
   toolchain or requesting npm credentials.

The policy requires at least one reviewer, prevents the person who dispatched
the workflow from approving that same run, rejects administrator bypass, and
admits only protected branches. If the triggering maintainer is the only
eligible reviewer, the run intentionally cannot proceed. Before the first
publication, grant an independent maintainer at least repository read access
and add that person or their team to the environment's required reviewers.
Never weaken self-review or administrator-bypass protection to work around a
single-maintainer reviewer set.

Audit the live, read-only policy without publishing anything:

```bash
node scripts/verify-tooling-release-environment.mjs --live
yarn test:tooling-release-workflow
```

The expected result states that self-review and administrator bypass are off
and protected branches are on. A network/API failure also fails closed; the
checked-in policy is not treated as proof of the live GitHub setting.

The tooling workflow also checks out the workflow's protected `main` commit,
not the operator-supplied commit value. Before it executes any checked-in
script, it proves that the supplied release commit equals both that checkout
and current `origin/main`. This ordering matters: validating an arbitrary
checkout only after running its scripts would give unreviewed code access to a
release-capable job. Manual compiler releases likewise run only from the
`main` workflow ref. Automatic compiler releases accept only successful
`push` CI runs for this repository's own `main` branch. Checking all three
facts—event, repository, and branch—is important because a pull request from a
fork may also use a source branch named `main`; branch spelling alone does not
make that code trusted enough for a job with release write permission.

npm publication is intentionally deferred. The workflow and policy checks stay
in the repository so a future decision starts from a reviewed, fail-closed
contract rather than an improvised release.

If npm is later selected, npm currently permits trusted-publisher configuration
only after a package exists. Version `0.1.0` would therefore require a one-time
bootstrap by an explicitly authorized maintainer. That bootstrap must publish
the exact tarball produced and verified by `yarn test:tooling-package`, use a
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
   integrity; the verifier reads the archive itself, compares its paths, sizes,
   and modes with npm's pack report, and requires the exact reviewed list in
   `config/tooling-package-files.json`;
3. installs that tarball in a clean project, type-checks every code subpath, and
   imports every code and conformance-vector subpath at runtime;
4. creates a deterministic release receipt and SPDX 2.3 SBOM;
5. publishes those exact tarball bytes with npm provenance;
6. downloads the immutable registry package, compares it byte-for-byte with the
   reviewed tarball, and repeats the clean-consumer check;
7. retains the receipt, SBOM, pack inventory, npm publish output, registry
   lookup/download logs, registry metadata, and verification status as workflow
   evidence.

The registry lookup runs even when `npm publish` reports failure. This matters
because a network or client failure can be ambiguous: the registry may already
have accepted the immutable version even though the publishing command exited
nonzero. The evidence bundle therefore records the publish exit code and then
asks the registry what exists before recovery begins. A failure before
download, byte comparison, or clean-consumer verification still leaves the
earlier registry state and logs available to the operator.

Local release-contract checks do not publish:

```bash
yarn test:tooling-release-workflow
yarn test:tooling-package
```

`yarn --cwd tooling pack:check` is the package-scoped equivalent.

### Rotating pinned GitHub Actions

Dependabot is configured for weekly GitHub Actions updates. For a proposed
release-workflow action update:

1. confirm that the commit belongs to the official action repository and is
   the exact commit tagged by the version in the same-line comment;
2. review that action release's notes and security/runtime changes;
3. update the workflow SHA and version comment together;
4. update the corresponding reviewed expectation in
   `scripts/test-tooling-release-workflow.ts`;
5. run `yarn test:tooling-release-workflow`, then the full `yarn test:ci`.

Do not replace a full SHA with a major, floating, or branch reference to make a
Dependabot change smaller. The test deliberately rejects mutable references in
both `.github/workflows/release.yml` and
`.github/workflows/release-tooling.yml`.

### Changing production environment reviewers

GitHub environment updates replace the submitted reviewer list, so inspect the
current rule before changing it and reread it afterward:

```bash
gh api repos/fullofcaffeine/genes-ts/environments/tooling-npm-production \
  > /tmp/tooling-npm-production.before.json

# Make the reviewed environment change in GitHub settings or with the
# Environments REST API, preserving every intended reviewer and branch rule.

node scripts/verify-tooling-release-environment.mjs --live
```

The repository policy intentionally does not pin reviewer account IDs: reviewer
rotation is an operational setting, while the invariant is that at least one
eligible reviewer exists and the triggering actor cannot approve their own
run. Record the before/after API evidence in the review that authorizes a
rotation. Changing this policy does not authorize an npm publication.

### Version and changelog policy

- Change `tooling/package.json` and `tooling/CHANGELOG.md` together in the
  reviewed release-preparation pull request.
- When an intentional build change adds or removes a published file, update
  `config/tooling-package-files.json` in the same review. The package test
  rejects both undeclared additions and missing reviewed files; broad
  `dist/**/*.js` admission is intentionally not used.
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
