import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);

type PackagedArtifact = {
  outputPath: string;
  sourceCommit: string;
};

type ArtifactVerification = {
  paths: string[];
  sha256: string;
  size: number;
  sourceCommit: string;
};

const { packageHaxelib } = require(
  path.join(repoRoot, "scripts/release/package-haxelib.cjs")
) as {
  packageHaxelib(options: {
    outputPath: string;
    version: string;
    tag: string;
    sourceCommit: string;
    cwd: string;
  }): PackagedArtifact;
};
const { createDeterministicZipBytes } = require(
  path.join(repoRoot, "scripts/release/deterministic-zip.cjs")
) as {
  createDeterministicZipBytes(
    files: Record<string, Uint8Array>
  ): Buffer;
};
const { verifyReleaseArtifact } = require(
  path.join(repoRoot, "scripts/release/verify-release-artifact.cjs")
) as {
  verifyReleaseArtifact(options: {
    zipPath: string;
    version: string;
    tag: string;
    sourceCommit: string;
    cwd: string;
  }): ArtifactVerification;
};

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

const temporaryRoot = mkdtempSync(
  path.join(tmpdir(), "genes-release-artifact-test-")
);
try {
  const source = git(["rev-parse", "HEAD^{commit}"]);
  const before = git(["status", "--porcelain", "--untracked-files=no"]);
  const firstPath = path.join(temporaryRoot, "first.zip");
  const secondPath = path.join(temporaryRoot, "nested", "second.zip");
  const utcPath = path.join(temporaryRoot, "utc-process.zip");
  const kiritimatiPath = path.join(temporaryRoot, "kiritimati-process.zip");
  const version = "9.8.7";
  const tag = `v${version}`;

  const first = packageHaxelib({
    outputPath: firstPath,
    version,
    tag,
    sourceCommit: source,
    cwd: repoRoot,
  });
  const second = packageHaxelib({
    outputPath: secondPath,
    version,
    tag,
    sourceCommit: source,
    cwd: repoRoot,
  });
  assert.equal(first.sourceCommit, source);
  assert.equal(second.sourceCommit, source);
  assert.deepEqual(
    readFileSync(firstPath),
    readFileSync(secondPath),
    "one source commit must produce byte-identical packages"
  );

  // Run the packager in fresh processes because changing TZ on a child process
  // does not prove that ZIP encoding itself is independent of the parent
  // process's locale and timezone.
  const packageInFreshProcess = (outputPath: string, timezone: string) => {
    const childTemporaryRoot = path.join(
      temporaryRoot,
      `tmp-${timezone.replaceAll("/", "-")}`
    );
    mkdirSync(childTemporaryRoot, { recursive: true });
    const script = [
      `const { packageHaxelib } = require(${JSON.stringify(path.join(repoRoot, "scripts/release/package-haxelib.cjs"))});`,
      `packageHaxelib(${JSON.stringify({
        outputPath,
        version,
        tag,
        sourceCommit: source,
        cwd: repoRoot,
      })});`,
    ].join("\n");
    execFileSync(process.execPath, ["-e", script], {
      cwd: repoRoot,
      env: {
        ...process.env,
        LC_ALL: timezone === "UTC" ? "C" : "en_US.UTF-8",
        TZ: timezone,
        TMPDIR: childTemporaryRoot,
      },
      stdio: "pipe",
    });
  };
  packageInFreshProcess(utcPath, "UTC");
  packageInFreshProcess(kiritimatiPath, "Pacific/Kiritimati");
  assert.deepEqual(
    readFileSync(utcPath),
    readFileSync(kiritimatiPath),
    "fresh-process package bytes must not depend on locale, timezone, or temporary root"
  );

  const verified = verifyReleaseArtifact({
    zipPath: firstPath,
    version,
    tag,
    sourceCommit: source,
    cwd: repoRoot,
  });
  assert.equal(verified.sourceCommit, source);
  assert(verified.size > 0);
  assert.match(verified.sha256, /^[0-9a-f]{64}$/);
  assert(verified.paths.includes("src/genes/Generator.hx"));
  assert(verified.paths.includes("release-metadata.json"));

  const entries = unzipSync(new Uint8Array(readFileSync(firstPath)));
  const haxelib = JSON.parse(
    Buffer.from(entries["haxelib.json"]).toString("utf8")
  ) as { version: string; releasenote: string };
  const metadata = JSON.parse(
    Buffer.from(entries["release-metadata.json"]).toString("utf8")
  ) as {
    schemaVersion: number;
    version: string;
    tag: string;
    sourceCommit: string;
  };
  assert.deepEqual(haxelib, {
    ...JSON.parse(readFileSync(path.join(repoRoot, "haxelib.json"), "utf8")),
    version,
    releasenote: `${tag}: See GitHub Releases`,
  });
  assert.deepEqual(metadata, {
    schemaVersion: 1,
    version,
    tag,
    sourceCommit: source,
  });

  const tamperedEntries: Record<string, Uint8Array> = { ...entries };
  tamperedEntries["unexpected.txt"] = Buffer.from("not reviewed\n");
  const tamperedPath = path.join(temporaryRoot, "tampered.zip");
  writeFileSync(
    tamperedPath,
    createDeterministicZipBytes(tamperedEntries)
  );
  assert.throws(
    () =>
      verifyReleaseArtifact({
        zipPath: tamperedPath,
        version,
        tag,
        sourceCommit: source,
        cwd: repoRoot,
      }),
    /artifact inventory mismatch/
  );

  assert.equal(
    git(["status", "--porcelain", "--untracked-files=no"]),
    before,
    "release staging must not modify tracked source"
  );
  console.log(
    `release-artifact:ok (${verified.paths.length} files, sha256:${verified.sha256.slice(0, 12)})`
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
