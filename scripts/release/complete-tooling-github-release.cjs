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
  return `@genes-ts/tooling ${version} is the first reviewed GitHub-only distribution of Genes' framework-neutral host tooling.

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
  if (sbom.spdxVersion !== "SPDX-2.3") {
    fail("tooling release SBOM must use SPDX 2.3");
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
          "tagName,isDraft,isImmutable,isPrerelease,body,assets",
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

function verifyReleaseShape({ release, tag, notes, names, requireImmutable }) {
  if (!release || release.tagName !== tag) fail(`GitHub Release ${tag} is missing`);
  if (release.isPrerelease) fail("tooling release must not be a prerelease");
  if (release.body.replace(/\r\n/g, "\n") !== notes) {
    fail("hosted tooling release notes differ from the reviewed notes");
  }
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
  const options = { cwd, env: { ...process.env, GH_REPO: repository } };
  let release = releaseView(tag, options);

  if (release && !release.isDraft) {
    verifyReleaseShape({ release, tag, notes, names, requireImmutable: true });
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
          `@genes-ts/tooling ${version}`,
          "--notes-file",
          notesFile,
        ],
        options
      );
      release = releaseView(tag, options);
    }
    if (!release || !release.isDraft) fail("tooling release draft is unavailable");
    ensureTagPointsToSource({ tag, commit, options });
    if (release.body.replace(/\r\n/g, "\n") !== notes) {
      fail("existing tooling release draft has different notes");
    }

    const hosted = new Set((release.assets || []).map(({ name }) => name));
    for (const name of hosted) {
      if (!names.includes(name)) fail(`unexpected existing release asset: ${name}`);
    }
    for (const name of names) {
      if (!hosted.has(name)) {
        runGh(["release", "upload", tag, path.join(assetDirectory, name)], options);
      }
    }
    release = releaseView(tag, options);
    verifyReleaseShape({ release, tag, notes, names, requireImmutable: false });
    compareHostedAssets({ assetDirectory, names, tag, options });
    runGh(
      ["release", "edit", tag, "--draft=false", "--latest=false"],
      options
    );
    release = releaseView(tag, options);
    verifyReleaseShape({ release, tag, notes, names, requireImmutable: true });
    compareHostedAssets({ assetDirectory, names, tag, options });
    ensureTagPointsToSource({ tag, commit, options });
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
    });
  } catch (error) {
    console.error(`[tooling-release] ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  assetNames,
  completeToolingGithubRelease,
  releaseNotes,
  validateLocalAssets,
  versionFromTag,
};
