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
  ensureExactTag(options: {
    commit: string;
    repository: string;
    tag: string;
    executeGh(arguments_: string[]): string;
    verifyTag(options: { commit: string; tag: string }): void;
  }): void;
  ensureReleaseTag(options: {
    commit: string;
    repository: string;
    sourceMode: "first" | "recovery";
    tag: string;
    findTag(options: { tag: string }): boolean;
    checkMain(options: { commit: string }): void;
    createTag(options: {
      commit: string;
      repository: string;
      tag: string;
    }): void;
    verifyTag(options: { commit: string; tag: string }): void;
  }): void;
  requestDraftPublication(options: {
    commit: string;
    notesFile: string;
    tag: string;
    title: string;
    executeGh(arguments_: string[]): string;
  }): Error | null;
  verifyFinalHostedRelease(options: {
    assetDirectory: string;
    attempts: number;
    commit: string;
    names: readonly string[];
    notes: string;
    retryDelayMs: number;
    tag: string;
    title: string;
    readRelease(tag: string): object;
    verifyShape(options: { release: object }): void;
    compareAssets(options: { tag: string }): void;
    verifyTag(options: { commit: string; tag: string }): void;
    waitForRetry(milliseconds: number): void;
  }): object;
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
assert.doesNotMatch(workflow, /^\s*environment:/m);
assert.doesNotMatch(workflow, /verify-tooling-release-environment/);
assert.match(workflow, /permissions:\n\s+contents: write/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /ref: \$\{\{ github\.sha \}\}\n\s+path: release-controller/);
assert.match(workflow, /ref: \$\{\{ inputs\.commit \}\}/);
assert.match(workflow, /path: release-source/);
assert.match(workflow, /working-directory: release-source/);
assert.match(workflow, /NPM_RELEASE_VERSION: "11\.18\.0"/);
assert.match(workflow, /NPM_RELEASE_INTEGRITY: "sha512-/);
assert.match(workflow, /npm install --global "npm@\$\{NPM_RELEASE_VERSION\}"/);
assert.match(workflow, /tooling-v\$\{RELEASE_VERSION\}/);
assert.match(workflow, /yarn test:ci/);
assert.match(workflow, /uses: \.\/release-controller\/\.github\/actions\/setup-yarn/);
assert.doesNotMatch(workflow, /corepack|cache:\s*yarn/);
assert(
  workflow.indexOf("uses: ./release-controller/.github/actions/setup-yarn") <
    workflow.indexOf("run: yarn install --frozen-lockfile"),
  "standalone Yarn must be installed before the first Yarn command"
);
const goSetup = workflow.indexOf(
  "actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v7.0.0"
);
const beadsInstall = workflow.indexOf("yarn beads:install");
const haxeInstall = workflow.indexOf(
  "yarn lix install haxe ${{ steps.toolchains.outputs.haxe-stable }}"
);
const haxeSelect = workflow.indexOf(
  "yarn lix use haxe ${{ steps.toolchains.outputs.haxe-stable }}"
);
const formatterInstall = workflow.indexOf(
  "yarn haxelib install formatter 1.18.0 --quiet"
);
const completeReleaseGate = workflow.indexOf("yarn test:ci");
assert(
  goSetup > 0 &&
    goSetup < beadsInstall &&
    beadsInstall < haxeInstall &&
    haxeInstall < haxeSelect &&
    haxeSelect < formatterInstall &&
    formatterInstall < completeReleaseGate,
  "the release workflow must prepare Go, Beads, Haxe, and the formatter before the complete release gate"
);
assert.match(workflow, /go-version: "1\.26\.5"/);
assert.match(workflow, /npm pack \.\/tooling --json/);
assert.match(workflow, /cmp .*first.*second/s);
assert.match(workflow, /node scripts\/dist\/test-tooling-package\.js/);
assert.match(workflow, /node-version: 26\.1\.0/);
assert.match(workflow, /NPM_CONSUMER_VERSION: "10\.9\.4"/);
assert.match(
  workflow,
  /npm install --global --ignore-scripts "npm@\$\{NPM_CONSUMER_VERSION\}"/,
);
assert.match(workflow, /test "\$\(npm --version \| cut -d\. -f1\)" = "10"/);
assert.doesNotMatch(
  workflow,
  /authorization|RELEASE_AUTHORIZATION|Verify explicit GitHub-only release authorization/i
);
assert.match(
  workflow,
  /node \.\.\/release-controller\/scripts\/release\/complete-tooling-github-release\.cjs/
);
const finalMainCheck = workflow.lastIndexOf("git fetch --no-tags origin main");
assert(
  finalMainCheck > 0 && finalMainCheck < workflow.indexOf("yarn test:ci"),
  "the workflow must check current main before it runs release code"
);
assert.match(
  workflow,
  /git ls-remote --exit-code --tags origin "refs\/tags\/\$tag"/
);
assert.match(workflow, /git rev-list -n 1 "\$tag"/);
assert.match(
  workflow,
  /gh api --paginate[\s\\]*"repos\/\$\{GITHUB_REPOSITORY\}\/releases\?per_page=100"/
);
assert(
  workflow.indexOf("gh api --paginate") <
    workflow.indexOf("mode=recovery"),
  "recovery mode must require an existing GitHub Release, not only a tag"
);
assert.match(
  workflow,
  /if \[ "\$RELEASE_COMMIT" = "\$current_main" \]; then[\s\S]*mode=first[\s\S]*else[\s\S]*gh api --paginate[\s\S]*mode=recovery/
);
assert.match(workflow, /mode=recovery/);
assert.match(workflow, /mode=first/);
assert.match(workflow, /TOOLING_RELEASE_SOURCE_MODE: \$\{\{ steps\.source\.outputs\.mode \}\}/);
assert.doesNotMatch(workflow, /npm publish|haxelib submit|semantic-release/);

const releasePublisher = readFileSync(
  path.join(repoRoot, "scripts/release/complete-tooling-github-release.cjs"),
  "utf8"
);
assert.match(releasePublisher, /"--latest=false"/);
assert(
  releasePublisher.indexOf("verifyDraftSource({ release, tag, commit, options })") <
    releasePublisher.indexOf('"release", "upload"'),
  "the publisher must verify the protected tag before uploading assets"
);
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
const finalTagCheckInPublisher = releasePublisher.lastIndexOf(
  "verifyDraftSource({ release, tag, commit, options })"
);
const releaseTagLock = releasePublisher.lastIndexOf(
  "ensureReleaseTag({"
);
const publicationRequest = releasePublisher.lastIndexOf(
  "requestDraftPublication({"
);
const firstReleaseRead = releasePublisher.indexOf(
  "let release = releaseView(tag, options)"
);
const finalDraftRefresh = releasePublisher.lastIndexOf(
  "release = releaseView(tag, options);",
  publicationRequest
);
const finalDraftShapeCheck = releasePublisher.lastIndexOf(
  "verifyReleaseShape({ release, tag, title, notes, names, requireImmutable: false })",
  publicationRequest
);
const finalDraftByteCheck = releasePublisher.lastIndexOf(
  "compareHostedAssets({ assetDirectory, names, tag, options })",
  publicationRequest
);
const fullByteCheckBeforeFinalTag = releasePublisher.lastIndexOf(
  "compareHostedAssets({ assetDirectory, names, tag, options })",
  finalTagCheckInPublisher
);
const finalHostedVerification = releasePublisher.indexOf(
  "verifyFinalHostedRelease({",
  publicationRequest
);
assert(
  releaseTagLock >= 0 && releaseTagLock < firstReleaseRead,
  "the publisher must lock the release tag before any draft can create it"
);
assert(
  fullByteCheckBeforeFinalTag > missingAssetUpload &&
    fullByteCheckBeforeFinalTag < finalTagCheckInPublisher &&
    finalTagCheckInPublisher < finalDraftRefresh &&
    finalDraftRefresh < finalDraftShapeCheck &&
    finalDraftShapeCheck < finalDraftByteCheck &&
    finalDraftByteCheck < publicationRequest,
  "the publisher must refresh and compare the draft again after the final tag check"
);
assert(
  publicationRequest > finalDraftByteCheck &&
    publicationRequest < finalHostedVerification,
  "the publisher must verify the final hosted release even when the publish response is lost"
);
assert.match(releasePublisher, /tagName,targetCommitish,name,isDraft/);
assert.match(releasePublisher, /verifyReleaseMetadata\(\{ release, tag, title, notes \}\)/);
assert.match(releasePublisher, /"--target", commit/);
assert.match(releasePublisher, /"--title", title/);
assert.match(releasePublisher, /"--notes-file", notesFile/);

const reviewedLocalAction = "./release-controller/.github/actions/setup-yarn";
let reviewedLocalActionCount = 0;
for (const reference of workflow.matchAll(/uses:\s+([^\s#]+)/g)) {
  if (reference[1] === reviewedLocalAction) {
    reviewedLocalActionCount += 1;
    continue;
  }
  assert.match(
    reference[1],
    /@[0-9a-f]{40}$/,
    "GitHub-only tooling release actions must use reviewed full commit IDs"
  );
}
assert.equal(
  reviewedLocalActionCount,
  1,
  "GitHub-only tooling release must use the one reviewed local Yarn action exactly once"
);

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
const tagCommands: string[] = [];
const verifiedTags: string[] = [];
releaseHelpers.ensureExactTag({
  commit: currentCommit,
  repository: "fullofcaffeine/genes-ts",
  tag: "tooling-v0.1.0",
  executeGh(arguments_) {
    tagCommands.push(arguments_.join(" "));
    throw new Error("the tag already exists");
  },
  verifyTag({ commit, tag }) {
    verifiedTags.push(`${tag}@${commit}`);
  },
});
assert.deepEqual(tagCommands, [
  `api --method POST repos/fullofcaffeine/genes-ts/git/refs -f ref=refs/tags/tooling-v0.1.0 -f sha=${currentCommit}`,
]);
assert.deepEqual(verifiedTags, [
  `tooling-v0.1.0@${currentCommit}`,
]);
assert.throws(
  () =>
    releaseHelpers.ensureExactTag({
      commit: currentCommit,
      repository: "fullofcaffeine/genes-ts",
      tag: "tooling-v0.1.0",
      executeGh() {
        throw new Error("the tag already exists");
      },
      verifyTag() {
        throw new Error("tag points to different source");
      },
    }),
  /tag points to different source/
);
const releaseTagSteps: string[] = [];
releaseHelpers.ensureReleaseTag({
  commit: currentCommit,
  repository: "fullofcaffeine/genes-ts",
  sourceMode: "recovery",
  tag: "tooling-v0.1.0",
  findTag() {
    releaseTagSteps.push("find");
    return true;
  },
  checkMain() {
    releaseTagSteps.push("main");
  },
  createTag() {
    releaseTagSteps.push("create");
  },
  verifyTag() {
    releaseTagSteps.push("verify");
  },
});
assert.deepEqual(releaseTagSteps, ["find", "verify"]);

assert.throws(
  () =>
    releaseHelpers.ensureReleaseTag({
      commit: currentCommit,
      repository: "fullofcaffeine/genes-ts",
      sourceMode: "recovery",
      tag: "tooling-v0.1.0",
      findTag() {
        return true;
      },
      checkMain() {
        throw new Error("main check must not run for an existing tag");
      },
      createTag() {
        throw new Error("tag creation must not run for an existing tag");
      },
      verifyTag() {
        throw new Error("existing tag points to another commit");
      },
    }),
  /existing tag points to another commit/
);

releaseTagSteps.length = 0;
releaseHelpers.ensureReleaseTag({
  commit: currentCommit,
  repository: "fullofcaffeine/genes-ts",
  sourceMode: "first",
  tag: "tooling-v0.1.0",
  findTag() {
    releaseTagSteps.push("find");
    return false;
  },
  checkMain() {
    releaseTagSteps.push("main");
  },
  createTag() {
    releaseTagSteps.push("create");
  },
  verifyTag() {
    releaseTagSteps.push("verify");
  },
});
assert.deepEqual(releaseTagSteps, ["main", "create"]);

assert.throws(
  () =>
    releaseHelpers.ensureReleaseTag({
      commit: currentCommit,
      repository: "fullofcaffeine/genes-ts",
      sourceMode: "recovery",
      tag: "tooling-v0.1.0",
      findTag() {
        return false;
      },
      checkMain() {
        throw new Error("recovery must not fall back to current main");
      },
      createTag() {
        throw new Error("recovery must not create a missing tag");
      },
      verifyTag() {},
    }),
  /recovery tag is missing/
);

const lostPublishResponse = new Error("connection closed after publication");
assert.equal(
  releaseHelpers.requestDraftPublication({
    commit: currentCommit,
    notesFile: "/tmp/notes.md",
    tag: "tooling-v0.1.0",
    title: "@genes-ts/tooling 0.1.0",
    executeGh() {
      throw lostPublishResponse;
    },
  }),
  lostPublishResponse
);
assert.equal(
  releaseHelpers.requestDraftPublication({
    commit: currentCommit,
    notesFile: "/tmp/notes.md",
    tag: "tooling-v0.1.0",
    title: "@genes-ts/tooling 0.1.0",
    executeGh() {
      return "published";
    },
  }),
  null
);

let finalReleaseReads = 0;
const finalReleaseWaits: number[] = [];
const finalReleaseChecks: string[] = [];
const finalRelease = releaseHelpers.verifyFinalHostedRelease({
  assetDirectory: "/tmp/release",
  attempts: 3,
  commit: currentCommit,
  names: ["package.tgz"],
  notes: "reviewed notes",
  retryDelayMs: 7,
  tag: "tooling-v0.1.0",
  title: "@genes-ts/tooling 0.1.0",
  readRelease() {
    finalReleaseReads += 1;
    if (finalReleaseReads < 3) throw new Error("release is not visible yet");
    return { isImmutable: true };
  },
  verifyShape() {
    finalReleaseChecks.push("shape");
  },
  compareAssets() {
    finalReleaseChecks.push("bytes");
  },
  verifyTag() {
    finalReleaseChecks.push("tag");
  },
  waitForRetry(milliseconds) {
    finalReleaseWaits.push(milliseconds);
  },
});
assert.deepEqual(finalRelease, { isImmutable: true });
assert.equal(finalReleaseReads, 3);
assert.deepEqual(finalReleaseWaits, [7, 7]);
assert.deepEqual(finalReleaseChecks, ["shape", "bytes", "tag"]);
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
