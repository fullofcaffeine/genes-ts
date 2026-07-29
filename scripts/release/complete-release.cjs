#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const semver = require("semver");
const {
  assertTrackedTreeClean,
  buildApprovedArtifact,
  sourceCommit,
  verifyTagIdentity,
} = require("./haxelib-artifact-plugin.cjs");
const {
  normalizeReleaseNotes,
  notesForTag,
} = require("./release-notes-plugin.cjs");
const {
  approvedAssetIdentity,
  releaseView,
  verifyAsset,
  verifyHostedRelease,
} = require("./published-verifier-plugin.cjs");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env || process.env,
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });
}

function releaseVersionFromTag(tag) {
  if (!/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(tag)) {
    throw new Error("completion requires an existing vMAJOR.MINOR.PATCH tag");
  }
  const version = tag.slice(1);
  if (semver.valid(version, { loose: false }) === null) {
    throw new Error("completion tag is not valid SemVer");
  }
  return version;
}

/**
 * Validate an incomplete draft without replacing any already-hosted bytes.
 *
 * A retry may add a missing approved asset, but a same-name asset with
 * different bytes is a release incident. It is never deleted or overwritten.
 */
function draftAssetPlan({
  release,
  tag,
  expectedAssets,
  expectedNotes,
}) {
  if (!release || release.tagName !== tag) {
    throw new Error("draft GitHub Release tag does not match");
  }
  if (!release.isDraft) throw new Error("GitHub Release is not a draft");
  if (release.isImmutable) {
    throw new Error("draft GitHub Release unexpectedly reports immutable");
  }
  if (release.isPrerelease) {
    throw new Error("draft GitHub Release unexpectedly uses prerelease status");
  }
  if (
    normalizeReleaseNotes(release.body) !==
    normalizeReleaseNotes(expectedNotes)
  ) {
    throw new Error("draft GitHub Release notes do not match approved notes");
  }

  const expectedNames = Object.keys(expectedAssets).sort();
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const names = assets.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    throw new Error("draft GitHub Release contains duplicate asset names");
  }
  const unexpected = names.filter(
    (name) => !Object.prototype.hasOwnProperty.call(expectedAssets, name)
  );
  if (unexpected.length > 0) {
    throw new Error(
      `draft GitHub Release contains unexpected assets: ${unexpected.join(", ")}`
    );
  }
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  for (const name of names) {
    verifyAsset(byName.get(name), expectedAssets[name], `draft ${name}`);
  }
  return expectedNames.filter((name) => !byName.has(name));
}

function ensureDraft(tag, cwd, expectedNotes) {
  let release = releaseView(tag, cwd);
  if (release) return release;
  const notesRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "genes-ts-release-notes-")
  );
  const notesPath = path.join(notesRoot, "notes.md");
  try {
    fs.writeFileSync(notesPath, normalizeReleaseNotes(expectedNotes));
    run(
      "gh",
      [
        "release",
        "create",
        tag,
        "--verify-tag",
        "--draft",
        "--notes-file",
        notesPath,
        "--title",
        tag,
      ],
      { cwd, stdio: "inherit" }
    );
  } catch (error) {
    release = releaseView(tag, cwd);
    if (!release) throw error;
    return release;
  } finally {
    fs.rmSync(notesRoot, { recursive: true, force: true });
  }
  release = releaseView(tag, cwd);
  if (!release) {
    throw new Error("GitHub did not return the newly created draft Release");
  }
  return release;
}

function copyVersionedAssets({ cwd, artifact }) {
  const paths = {
    [artifact.names.archive]: path.join(cwd, "dist", artifact.names.archive),
    [artifact.names.checksum]: path.join(cwd, "dist", artifact.names.checksum),
  };
  fs.copyFileSync(artifact.zipPath, paths[artifact.names.archive]);
  fs.copyFileSync(artifact.checksumPath, paths[artifact.names.checksum]);
  return paths;
}

function uploadMissingAssets({
  tag,
  cwd,
  paths,
  missing,
  expectedAssets,
  expectedNotes,
}) {
  for (const name of missing) {
    try {
      run("gh", ["release", "upload", tag, paths[name]], {
        cwd,
        stdio: "inherit",
      });
    } catch (error) {
      const release = releaseView(tag, cwd);
      const stillMissing = draftAssetPlan({
        release,
        tag,
        expectedAssets,
        expectedNotes,
      });
      if (stillMissing.includes(name)) throw error;
    }
  }
}

async function completeRelease(tag, cwd = path.resolve(__dirname, "../..")) {
  const version = releaseVersionFromTag(tag);
  const source = sourceCommit(cwd);
  verifyTagIdentity({ tag, source, cwd });
  assertTrackedTreeClean(cwd);
  const expectedNotes = await notesForTag(tag, cwd);
  const artifact = buildApprovedArtifact({ cwd, version, tag, source });
  assertTrackedTreeClean(cwd);
  const expectedAssets = approvedAssetIdentity({ cwd, version });
  const existing = releaseView(tag, cwd);
  if (existing && !existing.isDraft) {
    verifyHostedRelease({
      cwd,
      version,
      tag,
      expectedAssets,
      expectedNotes,
    });
    console.log(`[release] ${tag} is already complete and immutable`);
    return;
  }

  let draft = ensureDraft(tag, cwd, expectedNotes);
  let missing = draftAssetPlan({
    release: draft,
    tag,
    expectedAssets,
    expectedNotes,
  });
  if (missing.length > 0) {
    const paths = copyVersionedAssets({ cwd, artifact });
    uploadMissingAssets({
      tag,
      cwd,
      paths,
      missing,
      expectedAssets,
      expectedNotes,
    });
    draft = releaseView(tag, cwd);
    missing = draftAssetPlan({
      release: draft,
      tag,
      expectedAssets,
      expectedNotes,
    });
    if (missing.length > 0) {
      throw new Error(`draft Release is still missing: ${missing.join(", ")}`);
    }
  }

  try {
    run("gh", ["release", "edit", tag, "--draft=false"], {
      cwd,
      stdio: "inherit",
    });
  } catch (_error) {
    // A lost API response is resolved by the authoritative final query.
  }
  verifyHostedRelease({
    cwd,
    version,
    tag,
    expectedAssets,
    expectedNotes,
  });
  console.log(`[release] completed immutable ${tag}`);
}

if (require.main === module) {
  (async () => {
    try {
      const [tag, ...rest] = process.argv.slice(2);
      if (!tag || rest.length > 0) {
        throw new Error(
          "usage: complete-release.cjs <existing vMAJOR.MINOR.PATCH tag>"
        );
      }
      await completeRelease(tag);
    } catch (error) {
      console.error(`[release] ERROR: ${error.message}`);
      process.exit(1);
    }
  })();
}

module.exports = {
  completeRelease,
  draftAssetPlan,
  releaseVersionFromTag,
};
