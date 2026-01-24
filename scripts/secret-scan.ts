import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import https from "node:https";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const GITLEAKS_VERSION = "8.18.2";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function run(cmd: string, args: ReadonlyArray<string>, opts: ExecFileSyncOptions = {}): void {
  execFileSync(cmd, [...args], {
    cwd: repoRoot,
    stdio: "inherit",
    ...opts
  });
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        download(res.headers.location, dest).then(resolve, reject);
        res.resume();
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode ?? "?"}`));
        res.resume();
        return;
      }

      const file = createWriteStream(dest);
      pipeline(res, file).then(resolve, reject);
    });
    req.on("error", reject);
  });
}

type PlatformInfo = {
  assetName: string;
  archiveType: "tar.gz" | "zip";
  binName: string;
};

function platformInfo(): PlatformInfo {
  const arch = (() => {
    switch (process.arch) {
      case "arm64":
        return "arm64";
      case "x64":
        return "x64";
      default:
        throw new Error(`Unsupported CPU arch for gitleaks: ${process.arch}`);
    }
  })();

  switch (process.platform) {
    case "darwin":
      return {
        assetName: `gitleaks_${GITLEAKS_VERSION}_darwin_${arch}.tar.gz`,
        archiveType: "tar.gz",
        binName: "gitleaks"
      };
    case "linux":
      return {
        assetName: `gitleaks_${GITLEAKS_VERSION}_linux_${arch}.tar.gz`,
        archiveType: "tar.gz",
        binName: "gitleaks"
      };
    case "win32":
      return {
        assetName: `gitleaks_${GITLEAKS_VERSION}_windows_${arch}.zip`,
        archiveType: "zip",
        binName: "gitleaks.exe"
      };
    default:
      throw new Error(`Unsupported platform for gitleaks: ${process.platform}`);
  }
}

async function ensureGitleaks(): Promise<string> {
  const info = platformInfo();
  const cacheDir = path.join(os.homedir(), ".cache", "genes-ts", "gitleaks", GITLEAKS_VERSION, `${process.platform}-${process.arch}`);
  mkdirSync(cacheDir, { recursive: true });

  const binPath = path.join(cacheDir, info.binName);
  if (existsSync(binPath)) {
    return binPath;
  }

  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${info.assetName}`;
  const archivePath = path.join(cacheDir, info.assetName);

  rmSync(archivePath, { force: true });
  await download(url, archivePath);

  if (info.archiveType === "tar.gz") {
    run("tar", ["-xzf", archivePath, "-C", cacheDir]);
  } else {
    run("unzip", ["-o", archivePath, "-d", cacheDir]);
  }

  if (!existsSync(binPath)) {
    throw new Error(`gitleaks binary not found after extraction: ${binPath}`);
  }
  try {
    chmodSync(binPath, 0o755);
  } catch {
    // Ignore chmod errors (e.g. Windows).
  }
  return binPath;
}

const gitleaks = await ensureGitleaks();

// Scan the git repo (history + current tree) for secrets. Requires fetch-depth 0 in CI.
run(gitleaks, ["detect", "--source", repoRoot, "--redact", "--no-banner"]);

