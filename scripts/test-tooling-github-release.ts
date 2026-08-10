import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import {
  existsSync,
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
assert.match(workflow, /permissions:\n\s+contents: write/);
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
assert.doesNotMatch(workflow, /npm publish|haxelib submit|semantic-release/);

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
  const tarballBytes = Buffer.from("reviewed package bytes", "utf8");
  const digest = createHash("sha256").update(tarballBytes).digest("hex");
  writeFileSync(path.join(fixture, tarball), tarballBytes);
  writeFileSync(path.join(fixture, `${tarball}.sha256`), `${digest}  ${tarball}\n`);
  writeFileSync(
    path.join(fixture, "release-receipt.json"),
    `${JSON.stringify({
      package: { name: "@genes-ts/tooling", version: "0.1.0" },
      source: { commit },
      artifact: { filename: tarball, sha256: digest },
    })}\n`
  );
  writeFileSync(
    path.join(fixture, "sbom.spdx.json"),
    `${JSON.stringify({ spdxVersion: "SPDX-2.3" })}\n`
  );
  releaseHelpers.validateLocalAssets({
    assetDirectory: fixture,
    commit,
    version: "0.1.0",
  });
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
