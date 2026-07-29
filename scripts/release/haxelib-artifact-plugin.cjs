const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { packageHaxelib } = require("./package-haxelib.cjs");
const {
  verifyReleaseArtifact,
} = require("./verify-release-artifact.cjs");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env || process.env,
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });
}

function normalizeSha(value, label) {
  const sha = String(value).trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`${label} is not a full Git commit SHA`);
  }
  return sha;
}

function sourceCommit(cwd) {
  const head = normalizeSha(
    run("git", ["rev-parse", "HEAD^{commit}"], { cwd }),
    "checked-out HEAD"
  );
  const tested = process.env.RELEASE_SOURCE_SHA
    ? normalizeSha(process.env.RELEASE_SOURCE_SHA, "RELEASE_SOURCE_SHA")
    : head;
  if (head !== tested) {
    throw new Error("release checkout does not match the CI-tested GITHUB_SHA");
  }
  return tested;
}

function assertTrackedTreeClean(cwd) {
  const status = run(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    { cwd }
  );
  if (status.trim()) {
    throw new Error("release preparation modified tracked repository files");
  }
}

function assertMeaningfulReleaseNotes(notes) {
  const contentLines = String(notes || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}\s/.test(line));
  if (contentLines.length === 0) {
    throw new Error(
      "generated release notes contain no entries; refusing to publish a heading-only release"
    );
  }
}

function artifactNames(version) {
  return {
    archive: `genes-ts-${version}.zip`,
    checksum: `genes-ts-${version}.zip.sha256`,
  };
}

function hash(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function verifyApprovedArtifact({
  zipPath,
  checksumPath,
  version,
  tag,
  source,
  cwd,
}) {
  const verified = verifyReleaseArtifact({
    zipPath,
    version,
    tag,
    sourceCommit: source,
    cwd,
  });
  const expected = `${verified.sha256}  ${artifactNames(version).archive}\n`;
  if (
    hash(zipPath) !== verified.sha256 ||
    fs.readFileSync(checksumPath, "utf8") !== expected
  ) {
    throw new Error("approved release artifact changed after preparation");
  }
  return verified;
}

function verifyTagIdentity({ tag, source, cwd }) {
  const local = normalizeSha(
    run("git", ["rev-parse", `${tag}^{commit}`], { cwd }),
    `local ${tag}`
  );
  if (local !== source) {
    throw new Error(`${tag} does not identify the CI-tested source commit`);
  }
  const remoteLine = run(
    "git",
    ["ls-remote", "--tags", "origin", `refs/tags/${tag}`],
    { cwd }
  ).trim();
  const [remote] = remoteLine.split(/\s+/);
  if (!remote || normalizeSha(remote, `origin ${tag}`) !== source) {
    throw new Error(`origin ${tag} does not identify the CI-tested source commit`);
  }
}

/**
 * Build the complete Haxelib package twice and approve only identical bytes.
 *
 * The public release must be reproducible from the exact tested commit. A
 * second build uses a different temporary root and time zone so accidental
 * timestamps, filesystem order, or staging paths cannot hide in the archive.
 */
function buildApprovedArtifact({ cwd, version, tag, source }) {
  const dist = path.join(cwd, "dist");
  const zipPath = path.join(dist, "genes-ts.zip");
  const checksumPath = path.join(dist, "genes-ts.zip.sha256");
  const repeatRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "genes-ts-release-repeat-")
  );
  const repeatZip = path.join(repeatRoot, "genes-ts.zip");
  try {
    fs.mkdirSync(dist, { recursive: true });
    fs.rmSync(zipPath, { force: true });
    fs.rmSync(checksumPath, { force: true });
    packageHaxelib({
      outputPath: zipPath,
      version,
      tag,
      sourceCommit: source,
      cwd,
    });
    packageHaxelib({
      outputPath: repeatZip,
      version,
      tag,
      sourceCommit: source,
      cwd,
      temporaryRoot: path.join(repeatRoot, "stage"),
      environment: {
        ...process.env,
        LC_ALL: "C",
        TZ: "Pacific/Kiritimati",
        TMPDIR: repeatRoot,
      },
    });
    if (!fs.readFileSync(zipPath).equals(fs.readFileSync(repeatZip))) {
      throw new Error("complete Haxelib package is not byte-for-byte reproducible");
    }
    const verified = verifyReleaseArtifact({
      zipPath,
      version,
      tag,
      sourceCommit: source,
      cwd,
    });
    const names = artifactNames(version);
    fs.writeFileSync(
      checksumPath,
      `${verified.sha256}  ${names.archive}\n`
    );
    return { checksumPath, names, verified, zipPath };
  } finally {
    fs.rmSync(repeatRoot, { recursive: true, force: true });
  }
}

async function prepare(_pluginConfig, context) {
  const cwd = context.cwd;
  const version = context.nextRelease.version;
  const tag = context.nextRelease.gitTag;
  assertMeaningfulReleaseNotes(context.nextRelease.notes);
  const source = sourceCommit(cwd);
  assertTrackedTreeClean(cwd);
  const artifact = buildApprovedArtifact({ cwd, version, tag, source });
  assertTrackedTreeClean(cwd);
  context.logger.success(
    `Prepared reproducible ${artifact.names.archive} ` +
      `(${artifact.verified.size} bytes, sha256:${artifact.verified.sha256}) from ${source}`
  );
}

async function publish(_pluginConfig, context) {
  const cwd = context.cwd;
  const version = context.nextRelease.version;
  const tag = context.nextRelease.gitTag;
  const source = sourceCommit(cwd);
  const zipPath = path.join(cwd, "dist", "genes-ts.zip");
  const checksumPath = path.join(cwd, "dist", "genes-ts.zip.sha256");
  verifyApprovedArtifact({
    zipPath,
    checksumPath,
    version,
    tag,
    source,
    cwd,
  });
  verifyTagIdentity({ tag, source, cwd });
  assertTrackedTreeClean(cwd);
  context.logger.success(
    `Verified ${tag} artifact and local/origin tag identity before GitHub publication`
  );
}

module.exports = {
  artifactNames,
  assertMeaningfulReleaseNotes,
  assertTrackedTreeClean,
  buildApprovedArtifact,
  prepare,
  publish,
  sourceCommit,
  verifyApprovedArtifact,
  verifyTagIdentity,
};
