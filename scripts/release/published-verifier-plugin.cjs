const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  artifactNames,
  sourceCommit,
  verifyTagIdentity,
} = require("./haxelib-artifact-plugin.cjs");
const {
  normalizeReleaseNotes,
} = require("./release-notes-plugin.cjs");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env || process.env,
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });
}

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function approvedAssetIdentity({ cwd, version }) {
  const names = artifactNames(version);
  const zipPath = path.join(cwd, "dist", "genes-ts.zip");
  const checksumPath = path.join(cwd, "dist", "genes-ts.zip.sha256");
  return {
    [names.archive]: {
      digest: `sha256:${sha256(zipPath)}`,
      size: fs.statSync(zipPath).size,
    },
    [names.checksum]: {
      digest: `sha256:${sha256(checksumPath)}`,
      size: fs.statSync(checksumPath).size,
    },
  };
}

function releaseView(tag, cwd) {
  try {
    return JSON.parse(
      run(
        "gh",
        [
          "release",
          "view",
          tag,
          "--json",
          "tagName,isDraft,isImmutable,isPrerelease,body,assets",
        ],
        { cwd }
      )
    );
  } catch (error) {
    const message = `${error.message || ""}\n${error.stderr || ""}`;
    if (/release not found|HTTP 404/i.test(message)) return null;
    throw error;
  }
}

function verifyAsset(asset, expected, label) {
  if (!asset || asset.state !== "uploaded") {
    throw new Error(`${label} is missing or not fully uploaded`);
  }
  if (asset.size !== expected.size || asset.digest !== expected.digest) {
    throw new Error(`${label} bytes do not match the approved local artifact`);
  }
}

function verifyReleaseSnapshot({
  release,
  tag,
  expectedAssets,
  expectedNotes,
}) {
  if (!release || release.tagName !== tag) {
    throw new Error("GitHub Release tag does not match");
  }
  if (release.isDraft) throw new Error("GitHub Release is still a draft");
  if (release.isPrerelease) {
    throw new Error("stable Genes release unexpectedly uses prerelease status");
  }
  if (!release.isImmutable) {
    throw new Error("GitHub Release is not immutable");
  }
  if (
    expectedNotes !== undefined &&
    normalizeReleaseNotes(release.body) !== normalizeReleaseNotes(expectedNotes)
  ) {
    throw new Error("GitHub Release notes do not match the approved notes");
  }
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const names = assets.map(({ name }) => name);
  const expectedNames = Object.keys(expectedAssets).sort();
  if (JSON.stringify([...names].sort()) !== JSON.stringify(expectedNames)) {
    throw new Error("GitHub Release custom asset inventory does not match");
  }
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  for (const name of expectedNames) {
    verifyAsset(byName.get(name), expectedAssets[name], name);
  }
}

function wait(milliseconds) {
  const state = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(state, 0, 0, milliseconds);
}

function verifyHostedRelease({
  cwd,
  version,
  tag,
  expectedAssets = approvedAssetIdentity({ cwd, version }),
  expectedNotes,
  attempts = 6,
  retryDelayMs = 1000,
}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const release = releaseView(tag, cwd);
      verifyReleaseSnapshot({
        release,
        tag,
        expectedAssets,
        expectedNotes,
      });
      return release;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) wait(retryDelayMs);
    }
  }
  throw lastError;
}

async function publish(_pluginConfig, context) {
  const cwd = context.cwd;
  const version = context.nextRelease.version;
  const tag = context.nextRelease.gitTag;
  const source = sourceCommit(cwd);
  verifyTagIdentity({ tag, source, cwd });
  verifyHostedRelease({
    cwd,
    version,
    tag,
    expectedNotes: context.nextRelease.notes,
  });
  context.logger.success(
    `Verified immutable ${tag} and its exact hosted package bytes`
  );
}

module.exports = {
  approvedAssetIdentity,
  publish,
  releaseView,
  verifyAsset,
  verifyHostedRelease,
  verifyReleaseSnapshot,
};
