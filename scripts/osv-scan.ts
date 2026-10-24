import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import https from "node:https";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

// 2.7 identifies Git dependencies by repository and commit rather than the
// Yarn alias's npm version. Keep the native fork checks in test:vulns too.
const OSV_SCANNER_VERSION = "2.7.0";
// Official v2.7.0 release asset SHA-256 values.
const OSV_SCANNER_SHA256: Readonly<Record<string, string>> = {
  "osv-scanner_darwin_amd64": "e82c5df7ab0a42dff29a1cd0660711447b56b4c0483ff66ad8634df10fd81a45",
  "osv-scanner_darwin_arm64": "d4926ef8da134332543be276dff157e4c170f99ad91fc48e89448a8816bdf70b",
  "osv-scanner_linux_amd64": "160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b",
  "osv-scanner_linux_arm64": "4061ef4c021ed3c47f203b818f337e351336cc5cd67c0274fc36bd1dfc728dd7",
  "osv-scanner_windows_amd64.exe": "9964ed64ec9a387391eb4cc006ad5c531154821aef29b793e02c448de4686438",
  "osv-scanner_windows_arm64.exe": "3e630381c1f1fd3c9c4d447e6ff2ef6c737083371722773db8337eead0f97962",
};

function verifyScanner(file: string, assetName: string): void {
  const expected = OSV_SCANNER_SHA256[assetName];
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (!expected || actual !== expected) {
    throw new Error(`OSV scanner checksum mismatch for ${assetName}; remove the invalid cache entry and retry`);
  }
}

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
    verifyScanner(binPath, info.assetName);
    return binPath;
  }

  const url = `https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/${info.assetName}`;
  rmSync(binPath, { force: true });
  await download(url, binPath);

  if (!existsSync(binPath)) {
    throw new Error(`osv-scanner binary not found after download: ${binPath}`);
  }
  verifyScanner(binPath, info.assetName);

  try {
    chmodSync(binPath, 0o755);
  } catch {
    // Ignore chmod errors (e.g. Windows).
  }

  return binPath;
}

const osvScanner = await ensureOsvScanner();

// Scan every lockfile installed by a required repository test. The focused CSS
// Modules tracer has its own npm package so it can prove the real processor and
// loader without adding those packages to the compiler's runtime dependencies.
// Note: This may perform network requests to OSV; it should be run in CI.
const configPath = path.join(repoRoot, ".osv-scanner.toml");
const lockfiles = [
  "yarn.lock",
  "tests/css-module-companions/provider/package-lock.json",
];
run(osvScanner, [
  "scan",
  ...lockfiles.flatMap((lockfile) => ["--lockfile", lockfile]),
  ...(existsSync(configPath) ? ["--config", configPath] : []),
]);
