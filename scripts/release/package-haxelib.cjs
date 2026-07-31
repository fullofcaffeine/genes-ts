#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { createDeterministicZip } = require("./deterministic-zip.cjs");
const { preparePackageMetadata } = require("./prepare-package-metadata.cjs");

const ROOT = path.resolve(__dirname, "../..");
const PACKAGE_PATHS = [
  "src",
  "haxelib.json",
  "readme.md",
  "extraParams.hxml",
  "config/stdlib-overrides.json",
  "docs/STDLIB_OVERRIDES.md",
  "tests/stdlib-overrides/README.md",
];

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd || ROOT,
    encoding: options.encoding || "utf8",
    env: options.environment || process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function resolveSourceCommit(
  sourceCommit,
  cwd = ROOT,
  environment = process.env
) {
  const resolved = String(
    git(["rev-parse", `${sourceCommit}^{commit}`], { cwd, environment })
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(resolved)) {
    throw new Error("source commit did not resolve to a full Git SHA");
  }
  return resolved;
}

/**
 * Package only tracked bytes from one exact commit.
 *
 * Exporting with `git archive` prevents an untracked file or a dirty working
 * tree from entering a public artifact. The only post-export mutations are the
 * reviewed version/provenance fields written into temporary staging.
 */
function packageHaxelib({
  outputPath,
  version,
  tag,
  sourceCommit,
  cwd = ROOT,
  temporaryRoot,
  environment = process.env,
}) {
  const resolvedSource = resolveSourceCommit(sourceCommit, cwd, environment);
  const ownedTemporaryRoot =
    temporaryRoot ||
    fs.mkdtempSync(path.join(os.tmpdir(), "genes-ts-haxelib-release-"));
  const stage = path.join(ownedTemporaryRoot, "package");
  fs.mkdirSync(stage, { recursive: true });

  try {
    const archive = git(
      ["archive", "--format=tar", resolvedSource, "--", ...PACKAGE_PATHS],
      { cwd, encoding: "buffer", environment }
    );
    const extracted = spawnSync("tar", ["-x", "-C", stage], {
      input: archive,
      encoding: "buffer",
      env: environment,
    });
    if (extracted.status !== 0) {
      throw new Error(
        `unable to extract tracked source archive: ${String(extracted.stderr)}`
      );
    }

    preparePackageMetadata({
      haxelibPath: path.join(stage, "haxelib.json"),
      metadataPath: path.join(stage, "release-metadata.json"),
      version,
      tag,
      sourceCommit: resolvedSource,
    });

    const output = path.resolve(cwd, outputPath);
    createDeterministicZip(stage, output);
    return { outputPath: output, sourceCommit: resolvedSource };
  } finally {
    if (!temporaryRoot) {
      fs.rmSync(ownedTemporaryRoot, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  try {
    const [outputPath, version, tag, source = "HEAD", ...rest] =
      process.argv.slice(2);
    if (!outputPath || !version || !tag || rest.length > 0) {
      throw new Error(
        "usage: package-haxelib.cjs <output.zip> <version> <tag|development> [source-sha]"
      );
    }
    const packaged = packageHaxelib({
      outputPath,
      version,
      tag,
      sourceCommit: source,
    });
    console.log(
      `[package] wrote ${packaged.outputPath} from ${packaged.sourceCommit}`
    );
  } catch (error) {
    console.error(`[package] ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  PACKAGE_PATHS,
  packageHaxelib,
  resolveSourceCommit,
};
