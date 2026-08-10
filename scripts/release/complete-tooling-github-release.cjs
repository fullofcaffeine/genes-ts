#!/usr/bin/env node

/**
 * Completes one GitHub-only tooling release without publishing another product.
 *
 * Why: npm 10 cannot install the tooling subdirectory directly from Git, while
 * early host projects are not yet ready to depend on an npm-registry release.
 * A prebuilt archive gives those projects stable package bytes without making
 * the longer-lived registry promise.
 *
 * What: this command accepts four already-reviewed files, creates or resumes a
 * draft `tooling-vX.Y.Z` Release, compares the hosted bytes, publishes the
 * draft, and then requires GitHub to report the Release as immutable.
 *
 * How: the package receipt ties the archive to one protected-main commit and
 * exact digest. Existing notes, tags, and assets are accepted only when they
 * agree byte-for-byte. Nothing is deleted or replaced during recovery, and no
 * npm, Haxelib, or compiler release command is called here.
 */

const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const tar = require("tar");

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    env: options.env || process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runGh(args, options = {}) {
  return run("gh", args, options);
}

function versionFromTag(tag) {
  const match = /^tooling-v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) {
    fail("tooling release tag must use tooling-vMAJOR.MINOR.PATCH");
  }
  return match[1];
}

function assetNames(version) {
  const tarball = `genes-ts-tooling-${version}.tgz`;
  return [
    tarball,
    `${tarball}.sha256`,
    "release-receipt.json",
    "sbom.spdx.json",
  ];
}

function releaseNotes(version, commit) {
  const tag = `tooling-v${version}`;
  const tarball = `genes-ts-tooling-${version}.tgz`;
  return `@genes-ts/tooling ${version} is a reviewed GitHub-only distribution of Genes' framework-neutral host tooling.

It is intended for early consumers that need exact package bytes without an npm-registry release. npm can install the attached archive directly:

\`\`\`text
npm install https://github.com/fullofcaffeine/genes-ts/releases/download/${tag}/${tarball}
\`\`\`

The release receipt records the source commit, npm integrity value, SHA-256 and SHA-512 digests, and complete file inventory. The SPDX file records the package's software identity. This release does not publish to npm or Haxelib.

Source commit: \`${commit}\`
`;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function sha512(file) {
  return createHash("sha512").update(readFileSync(file)).digest("hex");
}

/**
 * Reads the package file list from the archive users will install.
 *
 * The nearby receipt is useful evidence, but it cannot prove itself. Reading
 * the archive here prevents an old or incorrect receipt from being published
 * beside different package bytes.
 */
function readArchiveFiles(tarball) {
  const files = [];
  tar.list({
    file: tarball,
    sync: true,
    strict: true,
    onReadEntry(entry) {
      if (entry.type !== "File") {
        fail(`tooling archive contains ${entry.type}: ${entry.path}`);
      }
      if (!entry.path.startsWith("package/")) {
        fail(`tooling archive entry is outside package/: ${entry.path}`);
      }
      const relativePath = entry.path.slice("package/".length);
      if (relativePath.length === 0 || relativePath.startsWith("/")) {
        fail(`tooling archive entry has an invalid path: ${entry.path}`);
      }
      files.push({ path: relativePath, size: entry.size });
    },
  });
  if (files.length === 0) fail("tooling archive contains no package files");
  const paths = files.map(({ path: filePath }) => filePath);
  if (new Set(paths).size !== paths.length) {
    fail("tooling archive contains a duplicate file path");
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function readJson(file, label) {
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must contain one JSON object`);
  }
  return value;
}

function validateLocalAssets({ assetDirectory, commit, version }) {
  const names = assetNames(version);
  const actual = readdirSync(assetDirectory).sort();
  if (actual.join("\n") !== [...names].sort().join("\n")) {
    fail(`release directory must contain exactly: ${names.join(", ")}`);
  }

  const tarballName = names[0];
  const tarball = path.join(assetDirectory, tarballName);
  const digest = sha256(tarball);
  const digest512 = sha512(tarball);
  const integrity = `sha512-${Buffer.from(digest512, "hex").toString("base64")}`;
  const archiveFiles = readArchiveFiles(tarball);
  const sidecar = readFileSync(
    path.join(assetDirectory, `${tarballName}.sha256`),
    "utf8"
  );
  if (sidecar !== `${digest}  ${tarballName}\n`) {
    fail("SHA-256 sidecar does not describe the exact release archive");
  }

  const receipt = readJson(
    path.join(assetDirectory, "release-receipt.json"),
    "release receipt"
  );
  if (
    receipt.schemaVersion !== 1 ||
    !receipt.package ||
    receipt.package.name !== "@genes-ts/tooling" ||
    receipt.package.version !== version ||
    !receipt.source ||
    receipt.source.repository !== "https://github.com/fullofcaffeine/genes-ts" ||
    receipt.source.commit !== commit ||
    !receipt.artifact ||
    receipt.artifact.filename !== tarballName ||
    receipt.artifact.sha256 !== digest ||
    receipt.artifact.sha512 !== digest512 ||
    receipt.artifact.integrity !== integrity ||
    JSON.stringify(receipt.artifact.files) !== JSON.stringify(archiveFiles)
  ) {
    fail(
      "release receipt does not match the archive bytes, file list, package, and source commit"
    );
  }

  const sbom = readJson(
    path.join(assetDirectory, "sbom.spdx.json"),
    "SPDX document"
  );
  const sbomPackage =
    Array.isArray(sbom.packages) && sbom.packages.length === 1
      ? sbom.packages[0]
      : null;
  const expectedPurl = `pkg:npm/%40genes-ts/tooling@${version}`;
  if (
    sbom.spdxVersion !== "SPDX-2.3" ||
    sbom.name !== `@genes-ts/tooling-${version}` ||
    !sbomPackage ||
    sbomPackage.name !== "@genes-ts/tooling" ||
    sbomPackage.versionInfo !== version ||
    !Array.isArray(sbomPackage.checksums) ||
    sbomPackage.checksums.length !== 1 ||
    sbomPackage.checksums[0].algorithm !== "SHA512" ||
    sbomPackage.checksums[0].checksumValue !== digest512 ||
    !Array.isArray(sbomPackage.externalRefs) ||
    sbomPackage.externalRefs.length !== 1 ||
    sbomPackage.externalRefs[0].referenceCategory !== "PACKAGE-MANAGER" ||
    sbomPackage.externalRefs[0].referenceType !== "purl" ||
    sbomPackage.externalRefs[0].referenceLocator !== expectedPurl
  ) {
    fail(
      "tooling release SBOM does not match the archive checksum, package, version, and npm package URL"
    );
  }
  return names;
}

function releaseView(tag, options = {}) {
  try {
    return JSON.parse(
      runGh(
        [
          "release",
          "view",
          tag,
          "--json",
          "tagName,targetCommitish,name,isDraft,isImmutable,isPrerelease,body,assets",
        ],
        options
      )
    );
  } catch (error) {
    const message = `${error.stderr || ""}${error.message || ""}`;
    if (/release not found|HTTP 404/i.test(message)) return null;
    throw error;
  }
}

function verifyReleaseMetadata({ release, tag, title, notes }) {
  if (!release || release.tagName !== tag) fail(`GitHub Release ${tag} is missing`);
  if (release.name !== title) fail("hosted tooling release title differs from the reviewed title");
  if (release.isPrerelease) fail("tooling release must not be a prerelease");
  if (release.body.replace(/\r\n/g, "\n") !== notes) {
    fail("hosted tooling release notes differ from the reviewed notes");
  }
}

function verifyReleaseShape({ release, tag, title, notes, names, requireImmutable }) {
  verifyReleaseMetadata({ release, tag, title, notes });
  if (requireImmutable && (release.isDraft || !release.isImmutable)) {
    fail("published tooling release is not immutable");
  }
  const hostedNames = (release.assets || []).map(({ name }) => name).sort();
  if (hostedNames.join("\n") !== [...names].sort().join("\n")) {
    fail("hosted tooling release assets differ from the reviewed asset set");
  }
}

function compareHostedAssets({ assetDirectory, names, tag, options = {} }) {
  const temporary = mkdtempSync(
    path.join(os.tmpdir(), "genes-tooling-hosted-release-")
  );
  try {
    for (const name of names) {
      runGh(
        ["release", "download", tag, "--pattern", name, "--dir", temporary],
        options
      );
      const local = readFileSync(path.join(assetDirectory, name));
      const hosted = readFileSync(path.join(temporary, name));
      if (!local.equals(hosted)) {
        fail(`hosted ${name} differs from the reviewed local bytes`);
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function ensureTagPointsToSource({ tag, commit, options = {} }) {
  run("git", ["fetch", "origin", `refs/tags/${tag}:refs/tags/${tag}`], options);
  const actual = run("git", ["rev-list", "-n", "1", tag], options).trim();
  if (actual !== commit) {
    fail(`${tag} points to ${actual}, not reviewed source ${commit}`);
  }
}

/**
 * Creates the release tag at the reviewed commit before a draft can become
 * public. The GitHub create operation is atomic: only one caller can create
 * the name. If another caller wins, the required follow-up check accepts only
 * the same commit.
 */
function ensureExactTag({
  repository,
  tag,
  commit,
  options = {},
  executeGh = runGh,
  verifyTag = ensureTagPointsToSource,
}) {
  try {
    executeGh(
      [
        "api",
        "--method",
        "POST",
        `repos/${repository}/git/refs`,
        "-f",
        `ref=refs/tags/${tag}`,
        "-f",
        `sha=${commit}`,
      ],
      options
    );
  } catch (_error) {
    // A matching retry reports that the name exists. The exact check below
    // distinguishes that safe case from a wrong tag or a failed creation.
  }
  verifyTag({ tag, commit, options });
}

/**
 * Confirms that the reviewed commit is current before the first tag creation.
 * A retry with an existing exact tag does not call this function.
 */
function ensureCurrentMain({ commit, options = {}, execute = run }) {
  execute("git", ["fetch", "--no-tags", "origin", "main"], options);
  const current = execute("git", ["rev-parse", "origin/main"], options).trim();
  if (current !== commit) {
    fail(`origin/main moved to ${current}; reviewed source is ${commit}`);
  }
}

/**
 * Reports whether the remote already contains this exact tag name.
 */
function remoteTagExists({ tag, options = {}, execute = run }) {
  return execute(
    "git",
    ["ls-remote", "--tags", "origin", `refs/tags/${tag}`],
    options
  ).trim() !== "";
}

/**
 * Locks one release source before GitHub can create a draft.
 *
 * A first attempt can create the tag only while the reviewed commit is current
 * main. A retry can continue after main moves because the protected tag already
 * locks the exact source. A wrong existing tag always stops the release.
 */
function ensureReleaseTag({
  repository,
  tag,
  commit,
  sourceMode,
  options = {},
  findTag = remoteTagExists,
  checkMain = ensureCurrentMain,
  createTag = ensureExactTag,
  verifyTag = ensureTagPointsToSource,
}) {
  if (sourceMode === "recovery") {
    if (!findTag({ tag, options })) {
      fail(`recovery tag is missing: ${tag}`);
    }
    verifyTag({ tag, commit, options });
    return;
  }
  if (sourceMode !== "first") {
    fail("tooling release source mode must be first or recovery");
  }
  checkMain({ commit, options });
  createTag({ repository, tag, commit, options });
}

function wait(milliseconds) {
  const state = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(state, 0, 0, milliseconds);
}

/**
 * Repeats the final public Release check while GitHub settles its state.
 *
 * Each attempt checks the immutable release details, all hosted bytes, and the
 * protected tag. A bounded retry handles a short delay without hiding a real
 * mismatch.
 */
function verifyFinalHostedRelease({
  assetDirectory,
  names,
  tag,
  commit,
  title,
  notes,
  options = {},
  attempts = 6,
  retryDelayMs = 1000,
  readRelease = releaseView,
  verifyShape = verifyReleaseShape,
  compareAssets = compareHostedAssets,
  verifyTag = ensureTagPointsToSource,
  waitForRetry = wait,
}) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    fail("final release check needs at least one attempt");
  }
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0) {
    fail("final release retry delay must be a non-negative integer");
  }
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const release = readRelease(tag, options);
      verifyShape({
        release,
        tag,
        title,
        notes,
        names,
        requireImmutable: true,
      });
      compareAssets({ assetDirectory, names, tag, options });
      verifyTag({ tag, commit, options });
      return release;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) waitForRetry(retryDelayMs);
    }
  }
  throw lastError;
}

/**
 * Checks the protected tag before draft assets can be uploaded or published.
 */
function verifyDraftSource({ tag, commit, options = {} }) {
  ensureTagPointsToSource({ tag, commit, options });
}

/**
 * Asks GitHub to publish the draft and returns a possible request error.
 *
 * A network connection can close after GitHub publishes the release. The
 * caller must always read and verify the hosted release before it reports that
 * this request failed.
 */
function requestDraftPublication({
  tag,
  commit,
  title,
  notesFile,
  options = {},
  executeGh = runGh,
}) {
  try {
    executeGh(
      [
        "release", "edit", tag,
        "--target", commit,
        "--title", title,
        "--notes-file", notesFile,
        "--prerelease=false",
        "--draft=false",
        "--latest=false",
      ],
      options
    );
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Publishes one exact candidate or verifies that the same release already won.
 *
 * Draft publication is intentionally resumable because a network failure can
 * happen between tag creation, four uploads, and the final publish request.
 * Recovery is safe only in the matching direction: missing approved assets may
 * be uploaded, but an unexpected name or different byte immediately stops the
 * run. Once the Release is public, this function becomes a read-only verifier.
 */
function completeToolingGithubRelease({
  assetDirectory,
  commit,
  repository,
  tag,
  sourceMode,
  cwd = process.cwd(),
}) {
  if (!/^[0-9a-f]{40}$/.test(commit)) fail("source commit must be forty hex characters");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    fail("repository must use OWNER/NAME form");
  }
  const version = versionFromTag(tag);
  const packageJson = readJson(path.join(cwd, "tooling/package.json"), "tooling package");
  if (packageJson.name !== "@genes-ts/tooling" || packageJson.version !== version) {
    fail("tooling package identity does not match the requested release tag");
  }
  const head = run("git", ["rev-parse", "HEAD"], { cwd }).trim();
  if (head !== commit) fail("release source must equal the checked-out commit");
  const trackedChanges = run(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    { cwd }
  ).trim();
  if (trackedChanges !== "") fail("release checkout has tracked changes");

  const names = validateLocalAssets({ assetDirectory, commit, version });
  const notes = releaseNotes(version, commit);
  const title = `@genes-ts/tooling ${version}`;
  const options = { cwd, env: { ...process.env, GH_REPO: repository } };
  // A draft creation can create its missing tag automatically. Lock the source
  // first. A safe retry can use an exact existing tag after main moves.
  ensureReleaseTag({ repository, tag, commit, sourceMode, options });
  let release = releaseView(tag, options);

  if (release && !release.isDraft) {
    verifyReleaseShape({ release, tag, title, notes, names, requireImmutable: true });
    ensureTagPointsToSource({ tag, commit, options });
    compareHostedAssets({ assetDirectory, names, tag, options });
    console.log(`[tooling-release] ${tag} is already complete and immutable`);
    return release;
  }

  const notesDirectory = mkdtempSync(
    path.join(os.tmpdir(), "genes-tooling-release-notes-")
  );
  try {
    const notesFile = path.join(notesDirectory, "notes.md");
    writeFileSync(notesFile, notes, "utf8");
    if (!release) {
      runGh(
        [
          "release",
          "create",
          tag,
          "--target",
          commit,
          "--draft",
          "--latest=false",
          "--title",
          title,
          "--notes-file",
          notesFile,
        ],
        options
      );
      release = releaseView(tag, options);
    }
    if (!release || !release.isDraft) fail("tooling release draft is unavailable");
    verifyReleaseMetadata({ release, tag, title, notes });
    verifyDraftSource({ release, tag, commit, options });

    const hosted = new Set((release.assets || []).map(({ name }) => name));
    for (const name of hosted) {
      if (!names.includes(name)) fail(`unexpected existing release asset: ${name}`);
    }
    // A retry may find some files from an interrupted upload. Check those
    // bytes first. If any existing file differs, stop before adding more files
    // to a draft that cannot be repaired by deleting or replacing assets.
    compareHostedAssets({
      assetDirectory,
      names: names.filter((name) => hosted.has(name)),
      tag,
      options,
    });
    for (const name of names) {
      if (!hosted.has(name)) {
        runGh(["release", "upload", tag, path.join(assetDirectory, name)], options);
      }
    }
    // Refresh all mutable draft facts after uploads and the source check. The
    // final edit also writes the reviewed metadata again in the same request
    // that makes the release public.
    release = releaseView(tag, options);
    verifyReleaseShape({ release, tag, title, notes, names, requireImmutable: false });
    compareHostedAssets({ assetDirectory, names, tag, options });
    verifyDraftSource({ release, tag, commit, options });
    // The tag check can take long enough for another authorized maintainer to
    // change a draft. Read and compare every mutable fact once more before the
    // request that makes those files immutable.
    release = releaseView(tag, options);
    verifyReleaseShape({ release, tag, title, notes, names, requireImmutable: false });
    compareHostedAssets({ assetDirectory, names, tag, options });
    const publicationError = requestDraftPublication({
      tag,
      commit,
      title,
      notesFile,
      options,
    });
    try {
      release = verifyFinalHostedRelease({
        assetDirectory,
        names,
        tag,
        commit,
        title,
        notes,
        options,
      });
    } catch (error) {
      if (publicationError) {
        const verificationMessage =
          error instanceof Error ? error.message : String(error);
        fail(
          `GitHub publication request failed (${publicationError.message}); ` +
          `the final hosted release check also failed (${verificationMessage})`
        );
      }
      throw error;
    }
    if (publicationError) {
      console.log(
        "[tooling-release] publish command reported an error; hosted verification succeeded"
      );
    }
    console.log(`[tooling-release] completed immutable ${tag}`);
    return release;
  } finally {
    rmSync(notesDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const [tag, assetDirectory, ...rest] = process.argv.slice(2);
    if (!tag || !assetDirectory || rest.length > 0) {
      fail("usage: complete-tooling-github-release.cjs tooling-vX.Y.Z <asset-directory>");
    }
    completeToolingGithubRelease({
      tag,
      assetDirectory: path.resolve(assetDirectory),
      commit: process.env.TOOLING_RELEASE_SOURCE_SHA || "",
      repository: process.env.GITHUB_REPOSITORY || "",
      sourceMode: process.env.TOOLING_RELEASE_SOURCE_MODE || "",
    });
  } catch (error) {
    console.error(`[tooling-release] ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  assetNames,
  completeToolingGithubRelease,
  ensureCurrentMain,
  ensureExactTag,
  ensureReleaseTag,
  requestDraftPublication,
  verifyFinalHostedRelease,
  releaseNotes,
  validateLocalAssets,
  versionFromTag,
};
