import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const releaseHelpers = require(
  path.join(repoRoot, "scripts/release/complete-tooling-github-release.cjs")
) as {
  assetNames(version: string): readonly string[];
  ensureCurrentMain(options: {
    commit: string;
    execute(command: string, arguments_: string[]): string;
  }): void;
  releaseNotes(version: string, commit: string): string;
  validateLocalAssets(options: {
    assetDirectory: string;
    commit: string;
    version: string;
  }): readonly string[];
  versionFromTag(tag: string): string;
};
const workflowPath = path.join(
  repoRoot,
  ".github/workflows/release-tooling-github.yml"
);

assert(
  existsSync(workflowPath),
  "GitHub-only tooling release workflow is missing"
);

const workflow = readFileSync(workflowPath, "utf8");
assert.match(workflow, /^name: Release tooling GitHub archive$/m);
assert.match(workflow, /^  workflow_dispatch:$/m);
assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
assert.match(workflow, /environment: tooling-npm-production/);
assert.match(
  workflow,
  /node scripts\/verify-tooling-release-environment\.mjs --live/
);
assert.match(workflow, /permissions:\n\s+contents: write/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /NPM_RELEASE_VERSION: "11\.18\.0"/);
assert.match(workflow, /NPM_RELEASE_INTEGRITY: "sha512-/);
assert.match(workflow, /npm install --global "npm@\$\{NPM_RELEASE_VERSION\}"/);
assert.match(workflow, /tooling-v\$\{RELEASE_VERSION\}/);
assert.match(workflow, /yarn test:ci/);
assert.match(workflow, /npm pack \.\/tooling --json/);
assert.match(workflow, /cmp .*first.*second/s);
assert.match(workflow, /node scripts\/dist\/test-tooling-package\.js/);
assert.match(workflow, /node-version: 20\.9\.0/);
assert.match(workflow, /test "\$\(npm --version \| cut -d\. -f1\)" = "10"/);
assert.match(
  workflow,
  /publish @genes-ts\/tooling@\$\{RELEASE_VERSION\} to GitHub from \$\{RELEASE_COMMIT\} without npm/
);
assert.match(
  workflow,
  /node scripts\/release\/complete-tooling-github-release\.cjs/
);
const finalMainCheck = workflow.lastIndexOf("git fetch --no-tags origin main");
const publisherCall = workflow.lastIndexOf(
  "node scripts/release/complete-tooling-github-release.cjs"
);
assert(
  finalMainCheck > 0 && finalMainCheck < publisherCall,
  "the workflow must re-check current main immediately before publishing"
);
assert.doesNotMatch(workflow, /npm publish|haxelib submit|semantic-release/);

const releasePublisher = readFileSync(
  path.join(repoRoot, "scripts/release/complete-tooling-github-release.cjs"),
  "utf8"
);
assert.match(releasePublisher, /"--latest=false"/);
assert(
  releasePublisher.indexOf("verifyDraftSource({ release, tag, commit, options })") <
    releasePublisher.indexOf('"release", "upload"'),
  "the publisher must verify an existing tag or exact draft target before uploading assets"
);
assert.match(releasePublisher, /release\.targetCommitish !== commit/);
const existingAssetCheck = releasePublisher.indexOf(
  "names: names.filter((name) => hosted.has(name))"
);
const missingAssetUpload = releasePublisher.indexOf(
  'runGh(["release", "upload"'
);
assert(
  existingAssetCheck > 0 && existingAssetCheck < missingAssetUpload,
  "a resumed draft must compare every existing asset before uploading a missing file"
);
const finalMainCheckInPublisher = releasePublisher.lastIndexOf(
  "ensureCurrentMain({ commit, options })"
);
const finalTagCheckInPublisher = releasePublisher.lastIndexOf(
  "verifyDraftSource({ release, tag, commit, options })"
);
const publishDraft = releasePublisher.lastIndexOf(
  '"--prerelease=false",\n        "--draft=false"'
);
assert(
  finalMainCheckInPublisher > 0 &&
    finalMainCheckInPublisher < finalTagCheckInPublisher &&
    finalTagCheckInPublisher < publishDraft,
  "the publisher must re-check main, then keep the tag-source check last before publication"
);
assert.match(releasePublisher, /tagName,targetCommitish,name,isDraft/);
assert.match(releasePublisher, /verifyReleaseMetadata\(\{ release, tag, title, notes \}\)/);
assert.match(releasePublisher, /"--target", commit/);
assert.match(releasePublisher, /"--title", title/);
assert.match(releasePublisher, /"--notes-file", notesFile/);

for (const reference of workflow.matchAll(/uses:\s+([^\s#]+)/g)) {
  assert.match(
    reference[1],
    /@[0-9a-f]{40}$/,
    "GitHub-only tooling release actions must use reviewed full commit IDs"
  );
}

assert.equal(releaseHelpers.versionFromTag("tooling-v0.1.0"), "0.1.0");
assert.throws(
  () => releaseHelpers.versionFromTag("v0.1.0"),
  /tooling-vMAJOR/
);
assert.deepEqual(releaseHelpers.assetNames("0.1.0"), [
  "genes-ts-tooling-0.1.0.tgz",
  "genes-ts-tooling-0.1.0.tgz.sha256",
  "release-receipt.json",
  "sbom.spdx.json",
]);
const currentCommit = "1111111111111111111111111111111111111111";
const mainCommands: string[] = [];
releaseHelpers.ensureCurrentMain({
  commit: currentCommit,
  execute(command, arguments_) {
    mainCommands.push(`${command} ${arguments_.join(" ")}`);
    return arguments_[0] === "rev-parse" ? `${currentCommit}\n` : "";
  },
});
assert.deepEqual(mainCommands, [
  "git fetch --no-tags origin main",
  "git rev-parse origin/main",
]);
assert.throws(
  () =>
    releaseHelpers.ensureCurrentMain({
      commit: currentCommit,
      execute(_command, arguments_) {
        return arguments_[0] === "rev-parse"
          ? `${"2".repeat(40)}\n`
          : "";
      },
    }),
  /origin\/main moved/
);
const notes = releaseHelpers.releaseNotes(
  "0.1.0",
  "1111111111111111111111111111111111111111"
);
assert.match(notes, /npm install https:\/\/github\.com\/fullofcaffeine\/genes-ts\/releases\/download\/tooling-v0\.1\.0\/genes-ts-tooling-0\.1\.0\.tgz/);
assert.match(notes, /does not publish to npm or Haxelib/);

const fixture = mkdtempSync(path.join(os.tmpdir(), "genes-tooling-release-test-"));
try {
  const commit = "1111111111111111111111111111111111111111";
  const tarball = "genes-ts-tooling-0.1.0.tgz";
  const archiveRoot = path.join(fixture, "archive");
  mkdirSync(path.join(archiveRoot, "package"), { recursive: true });
  const packageFiles = [
    { path: "file.txt", bytes: Buffer.from("reviewed package bytes", "utf8") },
    {
      path: "package.json",
      bytes: Buffer.from(
        '{"name":"@genes-ts/tooling","version":"0.1.0"}\n',
        "utf8"
      ),
    },
  ] as const;
  for (const file of packageFiles) {
    writeFileSync(path.join(archiveRoot, "package", file.path), file.bytes);
  }
  const packed = spawnSync(
    "tar",
    [
      "-czf",
      path.join(fixture, tarball),
      "-C",
      archiveRoot,
      ...packageFiles.map((file) => `package/${file.path}`),
    ],
    {
      encoding: "utf8",
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    }
  );
  assert.equal(packed.status, 0, packed.stderr);
  rmSync(archiveRoot, { recursive: true, force: true });
  const tarballBytes = readFileSync(path.join(fixture, tarball));
  const digest = createHash("sha256").update(tarballBytes).digest("hex");
  const digest512 = createHash("sha512").update(tarballBytes).digest("hex");
  const integrity = `sha512-${Buffer.from(digest512, "hex").toString("base64")}`;
  writeFileSync(path.join(fixture, tarball), tarballBytes);
  writeFileSync(path.join(fixture, `${tarball}.sha256`), `${digest}  ${tarball}\n`);
  writeFileSync(
    path.join(fixture, "release-receipt.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      package: { name: "@genes-ts/tooling", version: "0.1.0" },
      source: {
        repository: "https://github.com/fullofcaffeine/genes-ts",
        commit,
      },
      artifact: {
        filename: tarball,
        integrity,
        sha256: digest,
        sha512: digest512,
        files: packageFiles.map((file) => ({
          path: file.path,
          size: file.bytes.length,
        })),
      },
    })}\n`
  );
  writeFileSync(
    path.join(fixture, "sbom.spdx.json"),
    `${JSON.stringify({
      spdxVersion: "SPDX-2.3",
      name: "@genes-ts/tooling-0.1.0",
      packages: [
        {
          name: "@genes-ts/tooling",
          versionInfo: "0.1.0",
          checksums: [{ algorithm: "SHA512", checksumValue: digest512 }],
          externalRefs: [
            {
              referenceCategory: "PACKAGE-MANAGER",
              referenceType: "purl",
              referenceLocator: "pkg:npm/%40genes-ts/tooling@0.1.0",
            },
          ],
        },
      ],
    })}\n`
  );
  releaseHelpers.validateLocalAssets({
    assetDirectory: fixture,
    commit,
    version: "0.1.0",
  });
  const receiptPath = path.join(fixture, "release-receipt.json");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  receipt.artifact.integrity = "sha512-wrong";
  writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
  assert.throws(
    () =>
      releaseHelpers.validateLocalAssets({
        assetDirectory: fixture,
        commit,
        version: "0.1.0",
      }),
    /archive bytes, file list/
  );
  receipt.artifact.integrity = integrity;
  receipt.artifact.files[0].size += 1;
  writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
  assert.throws(
    () =>
      releaseHelpers.validateLocalAssets({
        assetDirectory: fixture,
        commit,
        version: "0.1.0",
      }),
    /archive bytes, file list/
  );
  receipt.artifact.files[0].size -= 1;
  writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
  const sbomPath = path.join(fixture, "sbom.spdx.json");
  const sbom = JSON.parse(readFileSync(sbomPath, "utf8"));
  sbom.packages[0].checksums[0].checksumValue = "wrong";
  writeFileSync(sbomPath, `${JSON.stringify(sbom)}\n`);
  assert.throws(
    () =>
      releaseHelpers.validateLocalAssets({
        assetDirectory: fixture,
        commit,
        version: "0.1.0",
      }),
    /SBOM does not match/
  );
  sbom.packages[0].checksums[0].checksumValue = digest512;
  sbom.packages[0].externalRefs[0].referenceLocator = "pkg:npm/wrong@0.1.0";
  writeFileSync(sbomPath, `${JSON.stringify(sbom)}\n`);
  assert.throws(
    () =>
      releaseHelpers.validateLocalAssets({
        assetDirectory: fixture,
        commit,
        version: "0.1.0",
      }),
    /SBOM does not match/
  );
  sbom.packages[0].externalRefs[0].referenceLocator =
    "pkg:npm/%40genes-ts/tooling@0.1.0";
  writeFileSync(sbomPath, `${JSON.stringify(sbom)}\n`);
  writeFileSync(path.join(fixture, `${tarball}.sha256`), `wrong  ${tarball}\n`);
  assert.throws(
    () =>
      releaseHelpers.validateLocalAssets({
        assetDirectory: fixture,
        commit,
        version: "0.1.0",
      }),
    /SHA-256 sidecar/
  );
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log(
  "tooling-github-release:ok (manual protected-main archive; no npm or compiler publication)"
);
