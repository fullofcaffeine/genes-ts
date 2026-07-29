#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const semver = require("semver");
const { unzipSync } = require("fflate");
const { PACKAGE_PATHS, resolveSourceCommit } = require("./package-haxelib.cjs");

const ROOT = path.resolve(__dirname, "../..");

function compareNames(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function hash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function expectedPackagePaths(sourceCommit, cwd = ROOT) {
  const output = execFileSync(
    "git",
    [
      "ls-tree",
      "-r",
      "--name-only",
      sourceCommit,
      "--",
      ...PACKAGE_PATHS,
    ],
    { cwd, encoding: "utf8" }
  );
  return [
    ...output.split(/\r?\n/).filter(Boolean),
    "release-metadata.json",
  ].sort(compareNames);
}

/**
 * Bind the archive's exact file inventory and metadata to one source commit.
 *
 * A ZIP existing is not sufficient release evidence. This verifier rejects
 * missing or unexpected paths, stale versions, wrong tags, and source metadata
 * that names a different commit before semantic-release creates a public tag.
 */
function verifyReleaseArtifact({
  zipPath,
  version,
  tag,
  sourceCommit,
  cwd = ROOT,
}) {
  if (semver.valid(version, { loose: false }) === null) {
    throw new Error(`invalid artifact semantic version: ${version}`);
  }
  if (tag !== "development" && tag !== `v${version}`) {
    throw new Error(`artifact tag must be development or v${version}`);
  }
  const source = resolveSourceCommit(sourceCommit, cwd);
  const bytes = fs.readFileSync(zipPath);
  const entries = unzipSync(new Uint8Array(bytes));
  const actualPaths = Object.keys(entries).sort(compareNames);
  const expectedPaths = expectedPackagePaths(source, cwd);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    const missing = expectedPaths.filter((name) => !actualPaths.includes(name));
    const unexpected = actualPaths.filter(
      (name) => !expectedPaths.includes(name)
    );
    throw new Error(
      `artifact inventory mismatch; missing=[${missing.join(", ")}], unexpected=[${unexpected.join(", ")}]`
    );
  }

  const parseEntry = (name) =>
    JSON.parse(Buffer.from(entries[name]).toString("utf8"));
  const haxelib = parseEntry("haxelib.json");
  const metadata = parseEntry("release-metadata.json");
  if (haxelib.version !== version) {
    throw new Error(
      `packaged haxelib version ${String(haxelib.version)} does not match ${version}`
    );
  }
  const expectedNote =
    tag === "development"
      ? "Development checkout"
      : `v${version}: See GitHub Releases`;
  if (haxelib.releasenote !== expectedNote) {
    throw new Error("packaged haxelib release note does not match its tag");
  }
  const expectedMetadata = {
    schemaVersion: 1,
    version,
    tag,
    sourceCommit: source,
  };
  if (JSON.stringify(metadata) !== JSON.stringify(expectedMetadata)) {
    throw new Error("release-metadata.json does not match the approved release");
  }

  return {
    paths: actualPaths,
    sha256: hash(bytes),
    size: bytes.length,
    sourceCommit: source,
  };
}

if (require.main === module) {
  try {
    const [zipPath, version, tag, sourceCommit, ...rest] =
      process.argv.slice(2);
    if (!zipPath || !version || !tag || !sourceCommit || rest.length > 0) {
      throw new Error(
        "usage: verify-release-artifact.cjs <archive.zip> <version> <tag> <source-sha>"
      );
    }
    const verified = verifyReleaseArtifact({
      zipPath,
      version,
      tag,
      sourceCommit,
    });
    console.log(
      `[artifact] OK: ${verified.size} bytes sha256:${verified.sha256}`
    );
  } catch (error) {
    console.error(`[artifact] ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  expectedPackagePaths,
  hash,
  verifyReleaseArtifact,
};
