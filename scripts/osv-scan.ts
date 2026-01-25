import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import https from "node:https";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const OSV_SCANNER_VERSION = "2.3.2";

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
  binName: string;
};

function platformInfo(): PlatformInfo {
  const arch = (() => {
    switch (process.arch) {
      case "arm64":
        return "arm64";
      case "x64":
        return "amd64";
      default:
        throw new Error(`Unsupported CPU arch for osv-scanner: ${process.arch}`);
    }
  })();

  switch (process.platform) {
    case "darwin":
      return { assetName: `osv-scanner_darwin_${arch}`, binName: "osv-scanner" };
    case "linux":
      return { assetName: `osv-scanner_linux_${arch}`, binName: "osv-scanner" };
    case "win32":
      return { assetName: `osv-scanner_windows_${arch}.exe`, binName: "osv-scanner.exe" };
    default:
      throw new Error(`Unsupported platform for osv-scanner: ${process.platform}`);
  }
}

async function ensureOsvScanner(): Promise<string> {
  const info = platformInfo();
  const cacheDir = path.join(
    os.homedir(),
    ".cache",
    "genes-ts",
    "osv-scanner",
    OSV_SCANNER_VERSION,
    `${process.platform}-${process.arch}`
  );
  mkdirSync(cacheDir, { recursive: true });

  const binPath = path.join(cacheDir, info.binName);
  if (existsSync(binPath)) {
    return binPath;
  }

  const url = `https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/${info.assetName}`;
  rmSync(binPath, { force: true });
  await download(url, binPath);

  if (!existsSync(binPath)) {
    throw new Error(`osv-scanner binary not found after download: ${binPath}`);
  }

  try {
    chmodSync(binPath, 0o755);
  } catch {
    // Ignore chmod errors (e.g. Windows).
  }

  return binPath;
}

const osvScanner = await ensureOsvScanner();

// Scan dependencies using yarn.lock as source of truth.
// Note: This may perform network requests to OSV; it should be run in CI.
const configPath = path.join(repoRoot, ".osv-scanner.toml");
run(osvScanner, ["scan", "--lockfile", "yarn.lock", ...(existsSync(configPath) ? ["--config", configPath] : [])]);
