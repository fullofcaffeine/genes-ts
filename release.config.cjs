/**
 * Derive SemVer from Conventional Commits and publish the exact tested source.
 *
 * Normal releases never modify tracked files. The artifact plugin injects the
 * derived version into temporary Haxelib staging, semantic-release tags the
 * current CI-tested commit, and GitHub publishes the approved package through
 * its draft/upload/publish flow.
 */
module.exports = {
  branches: ["main"],
  tagFormat: "v${version}",
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        preset: "conventionalcommits",
        releaseRules: [{ scope: "tooling", release: false }],
      },
    ],
    [
      "./scripts/release/release-notes-plugin.cjs",
      { preset: "conventionalcommits" },
    ],
    "./scripts/release/haxelib-artifact-plugin.cjs",
    [
      "@semantic-release/github",
      {
        successCommentCondition: false,
        failCommentCondition: false,
        releasedLabels: false,
        assets: [
          {
            path: "dist/genes-ts.zip",
            name: "genes-ts-${nextRelease.version}.zip",
            label: "genes-ts Haxelib package (${nextRelease.gitTag})",
          },
          {
            path: "dist/genes-ts.zip.sha256",
            name: "genes-ts-${nextRelease.version}.zip.sha256",
            label: "SHA-256 checksum",
          },
        ],
      },
    ],
    "./scripts/release/published-verifier-plugin.cjs",
  ],
};
