import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const GITLEAKS_VERSION = "8.18.2";

export type GitleaksScanMode = "repository" | "staged";

function run(
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  options: ExecFileSyncOptions = {}
): void {
  execFileSync(command, [...args], {
    cwd,
    stdio: "inherit",
    ...options
  });
}

function download(url: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        download(response.headers.location, destination).then(resolve, reject);
        response.resume();
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode ?? "?"}`));
        response.resume();
        return;
      }

      const file = createWriteStream(destination);
      pipeline(response, file).then(resolve, reject);
    });
    request.on("error", reject);
  });
}

type PlatformInfo = {
  assetName: string;
  archiveType: "tar.gz" | "zip";
  binaryName: string;
  sha256: string;
};

// These are the matching entries from the official v8.18.2 checksums asset.
// Keeping them beside platform selection makes a version bump fail reviewably:
// every executable archive needs a new upstream digest before it can run.
function platformInfo(): PlatformInfo {
  const architecture = (() => {
    switch (process.arch) {
      case "arm64":
        return "arm64";
      case "x64":
        return "x64";
      default:
        throw new Error(`Unsupported CPU architecture for gitleaks: ${process.arch}`);
    }
  })();

  switch (process.platform) {
    case "darwin":
      return {
        assetName: `gitleaks_${GITLEAKS_VERSION}_darwin_${architecture}.tar.gz`,
        archiveType: "tar.gz",
        binaryName: "gitleaks",
        sha256:
          architecture === "arm64"
            ? "7be53fa77d7ec10cb8a7085d6ebcf375d55dd4c71f2cf6e7e6bf11554847a095"
            : "b2dc4f853128062856273d422e2f29791a036641c1655feb83192078970fbfc0"
      };
    case "linux":
      return {
        assetName: `gitleaks_${GITLEAKS_VERSION}_linux_${architecture}.tar.gz`,
        archiveType: "tar.gz",
        binaryName: "gitleaks",
        sha256:
          architecture === "arm64"
            ? "4df25683f95b9e1dbb8cc71dac74d10067b8aba221e7f991e01cafa05bcbd030"
            : "6298c9235dfc9278c14b28afd9b7fa4e6f4a289cb1974bd27949fc1e9122bdee"
      };
    case "win32":
      if (architecture === "arm64") {
        throw new Error(`gitleaks ${GITLEAKS_VERSION} has no Windows arm64 release`);
      }
      return {
        assetName: `gitleaks_${GITLEAKS_VERSION}_windows_${architecture}.zip`,
        archiveType: "zip",
        binaryName: "gitleaks.exe",
        sha256: "aa19543417c668b15e89b3357413099d81a75029a8ebbaec5034b7c8cc33c7e5"
      };
    default:
      throw new Error(`Unsupported platform for gitleaks: ${process.platform}`);
  }
}

/**
 * Returns the repository-pinned gitleaks executable used by local and CI scans.
 *
 * Why: pre-commit and CI must agree on the scanner version. Depending on an
 * unrelated machine-global installation makes a green local commit weaker
 * than the required hosted check.
 *
 * What: the first invocation downloads gitleaks 8.18.2 into the user's Genes
 * cache and verifies the release archive against its pinned upstream SHA-256.
 * Later invocations reuse that executable.
 *
 * How: the archive is selected from the current Node platform/architecture and
 * unpacked outside the repository so hook execution never dirties the working
 * tree. Unsupported hosts fail closed instead of silently skipping scanning.
 */
export async function ensureGitleaks(workingDirectory: string): Promise<string> {
  const info = platformInfo();
  const cacheDirectory = path.join(
    os.homedir(),
    ".cache",
    "genes-ts",
    "gitleaks",
    GITLEAKS_VERSION,
    `${process.platform}-${process.arch}`
  );
  mkdirSync(cacheDirectory, { recursive: true });

  const binaryPath = path.join(cacheDirectory, info.binaryName);
  const verificationPath = `${binaryPath}.archive-sha256`;
  if (
    existsSync(binaryPath) &&
    existsSync(verificationPath) &&
    readFileSync(verificationPath, "utf8").trim() === info.sha256
  ) {
    return binaryPath;
  }

  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${info.assetName}`;
  const archivePath = path.join(cacheDirectory, info.assetName);

  rmSync(archivePath, { force: true });
  await download(url, archivePath);

  const actualSha256 = createHash("sha256")
    .update(readFileSync(archivePath))
    .digest("hex");
  if (actualSha256 !== info.sha256) {
    rmSync(archivePath, { force: true });
    throw new Error(
      `gitleaks archive checksum mismatch for ${info.assetName}: expected ${info.sha256}, received ${actualSha256}`
    );
  }

  if (info.archiveType === "tar.gz") {
    run("tar", ["-xzf", archivePath, "-C", cacheDirectory], workingDirectory);
  } else {
    run("unzip", ["-o", archivePath, "-d", cacheDirectory], workingDirectory);
  }

  if (!existsSync(binaryPath)) {
    throw new Error(`gitleaks binary not found after extraction: ${binaryPath}`);
  }

  try {
    chmodSync(binaryPath, 0o755);
  } catch {
    // Windows does not use POSIX execute bits.
  }
  writeFileSync(verificationPath, `${info.sha256}\n`);
  return binaryPath;
}

/**
 * Scans either the complete repository or the exact staged snapshot.
 *
 * Repository mode is the required CI/backstop scan and includes Git history.
 * Staged mode is intentionally narrower and fast enough for pre-commit: it
 * examines the index that would become the commit, not unrelated working-tree
 * edits. A finding is redacted and returned as a non-zero process status.
 */
export async function scanWithGitleaks(
  mode: GitleaksScanMode,
  repositoryRoot: string
): Promise<void> {
  const gitleaks = await ensureGitleaks(repositoryRoot);
  if (mode === "staged") {
    run(
      gitleaks,
      ["protect", "--staged", "--redact", "--no-banner", "--source", repositoryRoot],
      repositoryRoot
    );
    return;
  }

  run(
    gitleaks,
    ["detect", "--source", repositoryRoot, "--redact", "--no-banner"],
    repositoryRoot
  );
}
