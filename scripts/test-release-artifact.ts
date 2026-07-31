import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
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

const temporaryRoot = realpathSync(
  mkdtempSync(path.join(tmpdir(), "genes-release-artifact-test-"))
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
  assert(
    verified.paths.includes("src/haxe/io/Bytes.js.hx"),
    "the packaged compiler must contain its reviewed JavaScript stdlib overlay"
  );
  assert(
    verified.paths.includes("config/stdlib-overrides.json"),
    "the packaged compiler must contain the overlay provenance manifest"
  );
  assert(
    verified.paths.includes("docs/STDLIB_OVERRIDES.md"),
    "the packaged compiler must contain the overlay ownership guide"
  );
  assert(
    verified.paths.includes("tests/stdlib-overrides/README.md"),
    "the packaged ownership guide must not link to an omitted fixture guide"
  );
  assert(verified.paths.includes("release-metadata.json"));

  const entries = unzipSync(new Uint8Array(readFileSync(firstPath)));
  for (const requiredPath of [
    "src/haxe/io/Bytes.js.hx",
    "config/stdlib-overrides.json",
    "docs/STDLIB_OVERRIDES.md",
    "tests/stdlib-overrides/README.md",
  ]) {
    assert(
      entries[requiredPath] !== undefined,
      `the generated ZIP is missing ${requiredPath}`
    );
  }
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

  const consumerRoot = path.join(temporaryRoot, "stdlib-consumer");
  const consumerSource = path.join(consumerRoot, "src");
  const generatedRoot = path.join(consumerRoot, "src-gen");
  mkdirSync(path.join(consumerSource, "packagedstdlib"), { recursive: true });
  const selectedHaxe = JSON.parse(
    readFileSync(path.join(repoRoot, ".haxerc"), "utf8")
  ) as { version: string };
  writeFileSync(
    path.join(consumerRoot, ".haxerc"),
    JSON.stringify({
      version: selectedHaxe.version,
      // Lix's Haxe shim still selects the pinned compiler. This isolated
      // consumer deliberately asks it to resolve libraries through the local
      // Haxelib repository created below, rather than through the source
      // checkout's scoped descriptors.
      resolveLibs: "haxelib",
    }, null, 2) + "\n"
  );
  writeFileSync(
    path.join(consumerRoot, "package.json"),
    '{\n  "type": "module"\n}\n'
  );
  writeFileSync(
    path.join(consumerSource, "packagedstdlib", "Main.hx"),
    [
      "package packagedstdlib;",
      "",
      "import haxe.io.Bytes;",
      "",
      '@:native("console")',
      "extern class NodeConsole {",
      "  static function log(value:String):Void;",
      "}",
      "",
      "final class Main {",
      "  public static function main():Void {",
      '    NodeConsole.log(Bytes.ofHex("000f107f80ff").toHex());',
      "  }",
      "}",
      "",
    ].join("\n")
  );
  execFileSync("haxelib", ["newrepo"], {
    cwd: consumerRoot,
    stdio: "pipe",
  });
  execFileSync(
    "haxelib",
    ["install", firstPath, "--quiet"],
    {
      cwd: consumerRoot,
      stdio: "pipe",
    }
  );
  const installedPackage = path.join(
    consumerRoot,
    ".haxelib/genes-ts/9,8,7"
  );
  assert.deepEqual(
    readFileSync(path.join(installedPackage, "src/haxe/io/Bytes.js.hx")),
    Buffer.from(entries["src/haxe/io/Bytes.js.hx"]),
    "the isolated Haxelib repository must contain the exact packaged overlay"
  );
  const packagedCompile = spawnSync(
    "haxe",
    [
      "-v",
      "-lib", "genes-ts",
      "-cp", consumerSource,
      "--main", "packagedstdlib.Main",
      "-js", path.join(generatedRoot, "index.ts"),
      "-D", "genes.ts",
      "-D", "no-deprecation-warnings",
      "-D", "js-es=6",
      "-dce", "std",
    ],
    {
      cwd: consumerRoot,
      encoding: "utf8",
    }
  );
  if (packagedCompile.error !== undefined) throw packagedCompile.error;
  const packagedCompileOutput =
    `${packagedCompile.stdout}${packagedCompile.stderr}`;
  assert.equal(
    packagedCompile.status,
    0,
    "unpacked package compilation failed\n"
      + packagedCompileOutput.slice(-12_000)
  );
  assert.match(
    packagedCompileOutput.split(path.sep).join("/"),
    /Parsed .*stdlib-consumer\/\.haxelib\/genes-ts\/9,8,7\/src\/haxe\/io\/Bytes\.js\.hx/,
    "a clean -lib genes-ts consumer must select Bytes.js.hx from the isolated installed package"
  );
  const packagedBytes = readFileSync(
    path.join(generatedRoot, "haxe/io/Bytes.ts"),
    "utf8"
  );
  assert(
    packagedBytes.includes("const chars: number[] = [];")
      && packagedBytes.includes(
        "Register.unsafeCast<number>(HxOverrides.cca(str, i))"
      )
      && !packagedBytes.includes("static fastGet"),
    "the unpacked package must preserve Bytes.toHex typing and std DCE behavior"
  );
  const packagedDist = path.join(consumerRoot, "dist");
  execFileSync(
    process.execPath,
    [
      path.join(repoRoot, "scripts/run-typescript.mjs"),
      "legacyFloor",
      "--target", "ES2022",
      "--module", "NodeNext",
      "--moduleResolution", "NodeNext",
      "--strict",
      "--exactOptionalPropertyTypes",
      "--noUncheckedIndexedAccess",
      "--types", "node",
      "--verbatimModuleSyntax",
      "--skipLibCheck", "false",
      "--rootDir", generatedRoot,
      "--outDir", packagedDist,
      path.join(generatedRoot, "index.ts"),
    ],
    { cwd: repoRoot, stdio: "inherit" }
  );
  assert.equal(
    execFileSync(
      process.execPath,
      [path.join(packagedDist, "index.js")],
      { cwd: repoRoot, encoding: "utf8" }
    ).trim(),
    "000f107f80ff",
    "the unpacked package must preserve Bytes.toHex runtime behavior"
  );

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
