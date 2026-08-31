import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { EventEmitter } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatWatchEvent,
  inspectNativeExecutableFile,
  loadWatchValidator,
  parseWatchArguments,
  selectWatchExitCode,
  WatchOutputWriter,
  WatchCommandUsageError,
  watchOutputErrorExitCode,
} from "./commands/watch.js";
import type {
  DevelopmentEvent,
  JsonValue,
  ValidationTree,
} from "./session/index.js";

const repositoryRoot = realpathSync.native(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);
const root = realpathSync.native(
  mkdtempSync(path.join(os.tmpdir(), "genes-watch-cli-")),
);
const repositoryTemporaryRoot = path.join(repositoryRoot, ".tmp");
mkdirSync(repositoryTemporaryRoot, { recursive: true });
const watchFixtureRoot = realpathSync.native(
  mkdtempSync(path.join(repositoryTemporaryRoot, "genes-watch-cli-")),
);
const cli = fileURLToPath(new URL("./cli.js", import.meta.url));

function project(name: string): string {
  const directory = path.join(root, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function treeDigest(directory: string): string {
  const hash = createHash("sha256");
  const visit = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const absolute = path.join(current, name);
      const relative = path.relative(directory, absolute).split(path.sep).join("/");
      const stats = statSync(absolute);
      hash.update(relative);
      hash.update("\0");
      if (stats.isDirectory()) {
        visit(absolute);
      } else {
        hash.update(readFileSync(absolute));
      }
      hash.update("\0");
    }
  };
  visit(directory);
  return hash.digest("hex");
}

function validMain(message: string): string {
  return [
    "package;",
    "class Main {",
    "  static function main():Void {",
    `    trace(${JSON.stringify(message)});`,
    "  }",
    "}",
    "",
  ].join("\n");
}

function invalidMain(): string {
  return [
    "package;",
    "class Main {",
    "  static function main():Void {",
    '    trace("broken");',
    "",
  ].join("\n");
}

function nativeFixture(
  name: string,
  bytes: Buffer,
): string {
  const file = path.join(root, name);
  writeFileSync(file, bytes);
  chmodSync(file, 0o755);
  return file;
}

function elfFixture(): Buffer {
  const bytes = Buffer.alloc(64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  bytes.writeUInt16LE(3, 16);
  return bytes;
}

function thinMachOFixture(): Buffer {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(2, 12);
  return bytes;
}

function fatMachOFixture(): Buffer {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32BE(0xcafebabe, 0);
  bytes.writeUInt32BE(1, 4);
  bytes.writeUInt32BE(28, 16);
  bytes.writeUInt32BE(32, 20);
  thinMachOFixture().copy(bytes, 28);
  return bytes;
}

function peFixture(): Buffer {
  const bytes = Buffer.alloc(256);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(128, 0x3c);
  bytes.write("PE\0\0", 128, "binary");
  bytes.writeUInt16LE(2, 128 + 4 + 16);
  bytes.writeUInt16LE(0x0002, 128 + 4 + 18);
  bytes.writeUInt16LE(0x020b, 128 + 24);
  return bytes;
}

class ControlledWatchOutput extends EventEmitter {
  readonly chunks: Buffer[] = [];
  readonly callbacks: Array<(error?: Error | null) => void> = [];
  readonly results: boolean[] = [];
  destroyed = 0;
  autoComplete = true;
  writeError: Error | undefined;

  write(
    chunk: Buffer,
    callback: (error?: Error | null) => void,
  ): boolean {
    if (this.writeError !== undefined) throw this.writeError;
    this.chunks.push(Buffer.from(chunk));
    if (this.autoComplete) {
      queueMicrotask(() => callback());
    } else {
      this.callbacks.push(callback);
    }
    return this.results.shift() ?? true;
  }

  destroy(): void {
    this.destroyed += 1;
  }
}

async function settles(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

interface EventWaiter {
  readonly predicate: (event: DevelopmentEvent<JsonValue>) => boolean;
  readonly resolve: (event: DevelopmentEvent<JsonValue>) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

async function portClosed(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

try {
  const parsed = parseWatchArguments(
    [
      "--project-id",
      "plain/example",
      "--hxml",
      "first.hxml",
      "--hxml",
      "second.hxml",
      "--output",
      "src-gen/index.ts",
      "--allow-root",
      "../shared",
      "--lix",
      "--json-lines",
    ],
    root,
  );
  assert.equal(parsed.projectRoot, root);
  assert.deepEqual(parsed.hxmlFiles, ["first.hxml", "second.hxml"]);
  assert.deepEqual(parsed.allowedRoots, ["../shared"]);
  assert.equal(parsed.stateDirectory, ".genes/dev");
  assert.equal(parsed.haxeExecutable, "haxe");
  assert.equal(parsed.useLix, true);
  assert.equal(parsed.jsonLines, true);
  assert.throws(
    () => parseWatchArguments(["--project-id", "missing"], root),
    (error: unknown) =>
      error instanceof WatchCommandUsageError &&
      error.message === "At least one --hxml entry is required.",
  );
  for (const malformed of ["", "   ", "build", "build.HXML"]) {
    assert.throws(
      () =>
        parseWatchArguments(
          [
            "--project-id",
            "malformed-hxml",
            "--hxml",
            "first.hxml",
            "--hxml",
            malformed,
            "--output",
            "src-gen/index.js",
          ],
          root,
        ),
      (error: unknown) =>
        error instanceof WatchCommandUsageError &&
        error.message === "--hxml requires a non-empty path ending in .hxml.",
      `malformed repeated --hxml value ${JSON.stringify(malformed)} was accepted`,
    );
  }

  if (process.platform !== "win32") {
    const setupRoot = project("malformed-hxml-setup-order");
    const setupMarker = path.join(setupRoot, "haxe-invoked");
    const setupShim = path.join(setupRoot, "extensionless-haxe-shim");
    writeFileSync(
      setupShim,
      [
        `#!${process.execPath}`,
        `require("node:fs").writeFileSync(${JSON.stringify(setupMarker)}, "invoked");`,
        'process.stdout.write("4.3.7\\n");',
        "",
      ].join("\n"),
    );
    chmodSync(setupShim, 0o755);
    const malformedHxml = spawnSync(
      process.execPath,
      [
        cli,
        "watch",
        "--root",
        setupRoot,
        "--project-id",
        "malformed-hxml-setup-order",
        "--hxml",
        "",
        "--output",
        "src-gen/index.js",
        "--haxe",
        setupShim,
      ],
      { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(malformedHxml.status, 2, malformedHxml.stderr);
    assert.equal(
      existsSync(setupMarker),
      false,
      "malformed HXML must fail before the Haxe executable is touched",
    );
  }

  const elf = nativeFixture("native-linux", elfFixture());
  const machO = nativeFixture("native-macos", thinMachOFixture());
  const fatMachO = nativeFixture("native-universal", fatMachOFixture());
  const pe = nativeFixture("native-windows.exe", peFixture());
  const malformedPe = peFixture();
  malformedPe.writeUInt32LE(252, 0x3c);
  const malformedPePath = nativeFixture("malformed-windows.exe", malformedPe);
  const javaClass = nativeFixture(
    "java-class",
    Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 61]),
  );
  const malformedElf = elfFixture();
  malformedElf[6] = 0;
  const malformedElfPath = nativeFixture("malformed-linux", malformedElf);
  assert.equal(inspectNativeExecutableFile(elf, "linux"), true);
  assert.equal(inspectNativeExecutableFile(malformedElfPath, "linux"), false);
  assert.equal(inspectNativeExecutableFile(machO, "darwin"), true);
  assert.equal(inspectNativeExecutableFile(fatMachO, "darwin"), true);
  assert.equal(inspectNativeExecutableFile(javaClass, "darwin"), false);
  assert.equal(inspectNativeExecutableFile(pe, "win32"), true);
  assert.equal(inspectNativeExecutableFile(malformedPePath, "win32"), false);
  assert.equal(inspectNativeExecutableFile(elf, "darwin"), false);

  const orderedStream = new ControlledWatchOutput();
  orderedStream.results.push(false, true);
  const orderedFailures: Array<{ readonly exitCode: 0 | 1; readonly message: string }> = [];
  const orderedWriter = new WatchOutputWriter(orderedStream, {
    maxPendingRecords: 4,
    maxPendingBytes: 64,
    drainTimeoutMs: 50,
    onFailure: (failure) => orderedFailures.push(failure),
  });
  orderedWriter.writeLine('{"sequence":1}');
  orderedWriter.writeLine('{"sequence":2}');
  assert.deepEqual(
    orderedStream.chunks.map((chunk) => chunk.toString("utf8")),
    ['{"sequence":1}\n'],
    "the false-returned record must not be rewritten and later records must wait",
  );
  orderedStream.emit("drain");
  await settles();
  assert.deepEqual(
    orderedStream.chunks.map((chunk) => chunk.toString("utf8")),
    ['{"sequence":1}\n', '{"sequence":2}\n'],
  );
  await orderedWriter.finish();
  orderedWriter.dispose();
  assert.deepEqual(orderedFailures, []);
  assert.equal(orderedStream.listenerCount("error"), 0);
  assert.equal(orderedStream.listenerCount("drain"), 0);

  const boundedStream = new ControlledWatchOutput();
  boundedStream.results.push(false, true, true);
  const boundedFailures: Array<{ readonly exitCode: 0 | 1; readonly message: string }> = [];
  const boundedWriter = new WatchOutputWriter(boundedStream, {
    maxPendingRecords: 2,
    maxPendingBytes: 4,
    drainTimeoutMs: 50,
    onFailure: (failure) => boundedFailures.push(failure),
  });
  boundedWriter.writeLine("0");
  boundedWriter.writeLine("1");
  boundedWriter.writeLine("2");
  boundedWriter.writeLine("3");
  boundedWriter.writeLine("ignored");
  assert.equal(boundedFailures.length, 1, "overflow must fail exactly once");
  assert.equal(boundedFailures[0]?.exitCode, 1);
  assert.match(boundedFailures[0]?.message ?? "", /2 records and 4 bytes/u);
  boundedStream.emit("drain");
  await settles();
  await boundedWriter.finish();
  boundedWriter.dispose();
  assert.deepEqual(
    boundedStream.chunks.map((chunk) => chunk.toString("utf8")),
    ["0\n", "1\n", "2\n"],
    "overflow must retain one exact bounded prefix and ignore later records",
  );

  const unicodeStream = new ControlledWatchOutput();
  unicodeStream.results.push(false, true);
  const unicodeFailures: Array<{ readonly exitCode: 0 | 1; readonly message: string }> = [];
  const unicodeWriter = new WatchOutputWriter(unicodeStream, {
    maxPendingRecords: 2,
    maxPendingBytes: 3,
    drainTimeoutMs: 50,
    onFailure: (failure) => unicodeFailures.push(failure),
  });
  unicodeWriter.writeLine("blocked");
  unicodeWriter.writeLine("é");
  unicodeWriter.writeLine("x");
  assert.equal(unicodeFailures.length, 1, "queue bytes must use UTF-8 byte length");
  unicodeStream.emit("drain");
  await settles();
  await unicodeWriter.finish();
  unicodeWriter.dispose();

  const exactRecordStream = new ControlledWatchOutput();
  const exactRecordFailures: Array<{
    readonly exitCode: 0 | 1;
    readonly message: string;
  }> = [];
  const exactRecordWriter = new WatchOutputWriter(exactRecordStream, {
    maxPendingRecords: 2,
    maxPendingBytes: 5,
    drainTimeoutMs: 50,
    onFailure: (failure) => exactRecordFailures.push(failure),
  });
  exactRecordWriter.writeLine("éé");
  await exactRecordWriter.finish();
  exactRecordWriter.dispose();
  assert.deepEqual(exactRecordFailures, []);
  assert.deepEqual(
    exactRecordStream.chunks.map((chunk) => chunk.toString("utf8")),
    ["éé\n"],
    "a complete UTF-8 record exactly at the byte limit must be written",
  );

  const oversizedRecordStream = new ControlledWatchOutput();
  const oversizedRecordFailures: Array<{
    readonly exitCode: 0 | 1;
    readonly message: string;
  }> = [];
  const oversizedRecordWriter = new WatchOutputWriter(oversizedRecordStream, {
    maxPendingRecords: 2,
    maxPendingBytes: 4,
    drainTimeoutMs: 50,
    onFailure: (failure) => oversizedRecordFailures.push(failure),
  });
  oversizedRecordWriter.writeLine("éé");
  oversizedRecordWriter.writeLine("ignored");
  await oversizedRecordWriter.finish();
  oversizedRecordWriter.dispose();
  assert.equal(
    oversizedRecordStream.chunks.length,
    0,
    "an oversized first record must fail before the stream receives a write",
  );
  assert.equal(oversizedRecordFailures.length, 1);
  assert.match(oversizedRecordFailures[0]?.message ?? "", /exceeded 4 bytes/u);

  const epipedStream = new ControlledWatchOutput();
  const epipedFailures: Array<{ readonly exitCode: 0 | 1; readonly message: string }> = [];
  const epipedWriter = new WatchOutputWriter(epipedStream, {
    maxPendingRecords: 2,
    maxPendingBytes: 16,
    drainTimeoutMs: 50,
    onFailure: (failure) => epipedFailures.push(failure),
  });
  epipedStream.emit(
    "error",
    Object.assign(new Error("closed consumer"), { code: "EPIPE" }),
  );
  await epipedWriter.finish();
  epipedWriter.dispose();
  assert.equal(epipedFailures[0]?.exitCode, 0);

  const erroredStream = new ControlledWatchOutput();
  const emittedFailures: Array<{ readonly exitCode: 0 | 1; readonly message: string }> = [];
  const erroredWriter = new WatchOutputWriter(erroredStream, {
    maxPendingRecords: 2,
    maxPendingBytes: 16,
    drainTimeoutMs: 50,
    onFailure: (failure) => emittedFailures.push(failure),
  });
  erroredStream.emit("error", new Error("stream failed"));
  await erroredWriter.finish();
  erroredWriter.dispose();
  assert.equal(emittedFailures[0]?.exitCode, 1);

  const throwingStream = new ControlledWatchOutput();
  throwingStream.writeError = new Error("synchronous write failure");
  const synchronousFailures: Array<{
    readonly exitCode: 0 | 1;
    readonly message: string;
  }> = [];
  const throwingWriter = new WatchOutputWriter(throwingStream, {
    maxPendingRecords: 2,
    maxPendingBytes: 16,
    drainTimeoutMs: 50,
    onFailure: (failure) => synchronousFailures.push(failure),
  });
  throwingWriter.writeLine("record");
  await throwingWriter.finish();
  throwingWriter.dispose();
  assert.equal(synchronousFailures[0]?.exitCode, 1);

  const callbackStream = new ControlledWatchOutput();
  callbackStream.autoComplete = false;
  const callbackFailures: Array<{ readonly exitCode: 0 | 1; readonly message: string }> = [];
  const callbackWriter = new WatchOutputWriter(callbackStream, {
    maxPendingRecords: 2,
    maxPendingBytes: 16,
    drainTimeoutMs: 50,
    onFailure: (failure) => callbackFailures.push(failure),
  });
  callbackWriter.writeLine("record");
  callbackStream.callbacks.shift()?.(new Error("callback failed"));
  await callbackWriter.finish();
  callbackWriter.dispose();
  assert.equal(callbackFailures[0]?.exitCode, 1);

  const timeoutStream = new ControlledWatchOutput();
  timeoutStream.autoComplete = false;
  timeoutStream.results.push(false);
  const timeoutFailures: Array<{ readonly exitCode: 0 | 1; readonly message: string }> = [];
  const timeoutWriter = new WatchOutputWriter(timeoutStream, {
    maxPendingRecords: 2,
    maxPendingBytes: 16,
    drainTimeoutMs: 5,
    onFailure: (failure) => timeoutFailures.push(failure),
  });
  timeoutWriter.writeLine("record");
  await timeoutWriter.finish();
  timeoutWriter.dispose();
  assert.equal(timeoutStream.destroyed, 1);
  assert.equal(timeoutFailures[0]?.exitCode, 1);
  assert.match(timeoutFailures[0]?.message ?? "", /did not drain/u);

  const help = spawnSync(process.execPath, [cli, "watch", "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /genes watch --project-id/u);
  assert.match(help.stdout, /Haxe-only admission/u);
  assert.match(help.stdout, /never starts a framework server/u);
  assert.equal(selectWatchExitCode(undefined, 143), 143);
  assert.equal(selectWatchExitCode(143, 1), 1);
  assert.equal(selectWatchExitCode(0, 1), 1);
  assert.equal(selectWatchExitCode(1, 143), 1);
  assert.equal(selectWatchExitCode(143, 2), 2);
  assert.equal(
    watchOutputErrorExitCode(Object.assign(new Error("closed"), { code: "EPIPE" })),
    0,
  );
  assert.equal(watchOutputErrorExitCode(new Error("broken stdout")), 1);

  const validatorRoot = project("validator module");
  const validatorPath = path.join(validatorRoot, "validator.mjs");
  writeFileSync(
    validatorPath,
    [
      "export default {",
      "  policyFacts: { fixture: 'reviewed-validator', revision: 1 },",
      "  async validate() {",
      "    return { ok: false, diagnostic: { code: 'FIXTURE_REJECTED', message: 'fixture rejection' } };",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  const validator = await loadWatchValidator(validatorRoot, "validator.mjs");
  assert.equal(validator.kind, "module");
  assert.equal(validator.label, "validator.mjs");
  const validationTree: ValidationTree = Object.freeze({
    kind: "candidate",
    revision: 1,
    logicalOutputRoot: "src-gen",
    physicalRoot: path.join(validatorRoot, "candidate"),
    entryLogicalPath: "src-gen/index.ts",
    manifestDigest: "a".repeat(64),
    files: Object.freeze([]),
    extraFiles: Object.freeze([]),
    compilerData: Object.freeze([]),
  });
  assert.deepEqual(
    await validator.validate(validationTree, {
      signal: new AbortController().signal,
      recovery: false,
    }),
    {
      ok: false,
      diagnostic: {
        code: "FIXTURE_REJECTED",
        message: "fixture rejection",
      },
    },
  );
  const haxeOnly = await loadWatchValidator(validatorRoot);
  assert.equal(haxeOnly.kind, "haxe-only");
  assert.match(haxeOnly.label, /Haxe-only admission/u);

  const malformedValidator = path.join(validatorRoot, "malformed.mjs");
  writeFileSync(
    malformedValidator,
    "export default { policyFacts: new Date(), async validate() { return { ok: true }; } };\n",
  );
  await assert.rejects(
    loadWatchValidator(validatorRoot, "malformed.mjs"),
    /policyFacts must contain plain objects/u,
  );
  const outsideValidator = path.join(root, "outside-validator.mjs");
  writeFileSync(
    outsideValidator,
    "export default { policyFacts: {}, async validate() { return { ok: true }; } };\n",
  );
  await assert.rejects(
    loadWatchValidator(
      validatorRoot,
      path.relative(validatorRoot, outsideValidator),
    ),
    /must stay inside the project root/u,
  );
  const changingValidator = path.join(validatorRoot, "changing.mjs");
  writeFileSync(
    changingValidator,
    [
      'import { writeFileSync } from "node:fs";',
      'import { fileURLToPath } from "node:url";',
      'const current = fileURLToPath(new URL("./changing.mjs", import.meta.url));',
      "writeFileSync(",
      "  current,",
      '  "export default { policyFacts: {}, async validate() { return { ok: true }; } };\\n",',
      ");",
      "export default { policyFacts: {}, async validate() { return { ok: true }; } };",
      "",
    ].join("\n"),
  );
  await assert.rejects(
    loadWatchValidator(validatorRoot, "changing.mjs"),
    /changed while it was loading/u,
  );

  const fixtureRoot = watchFixtureRoot;
  const sourceRoot = path.join(fixtureRoot, "app-src");
  mkdirSync(sourceRoot);
  const haxeLibraries = path.join(fixtureRoot, "haxe_libraries");
  mkdirSync(haxeLibraries);
  cpSync(
    path.join(repositoryRoot, "haxe_libraries/helder.set.hxml"),
    path.join(haxeLibraries, "helder.set.hxml"),
  );
  writeFileSync(
    path.join(haxeLibraries, "genes-ts.hxml"),
    [
      "-lib helder.set",
      path.join(repositoryRoot, "extraParams.hxml"),
      `-cp ${path.join(repositoryRoot, "src")}`,
      "",
    ].join("\n"),
  );
  cpSync(path.join(repositoryRoot, ".haxerc"), path.join(fixtureRoot, ".haxerc"));
  writeFileSync(
    path.join(fixtureRoot, "build.hxml"),
    [
      "-lib genes-ts",
      "--class-path=app-src",
      "--main=Main",
      "--define=js-es=6",
      "--dce=full",
      "",
    ].join("\n"),
  );
  writeFileSync(path.join(fixtureRoot, "package.json"), '{"type":"module"}\n');
  const main = path.join(sourceRoot, "Main.hx");
  writeFileSync(main, invalidMain());

  if (process.platform !== "win32") {
    const launcherMarker = path.join(fixtureRoot, "launcher-invoked");
    const extensionlessLauncher = path.join(fixtureRoot, "extensionless-haxe");
    writeFileSync(
      extensionlessLauncher,
      [
        `#!${process.execPath}`,
        `require("node:fs").writeFileSync(${JSON.stringify(launcherMarker)}, "invoked");`,
        'process.stdout.write("4.3.7\\n");',
        "",
      ].join("\n"),
    );
    chmodSync(extensionlessLauncher, 0o755);
    const isolatedHome = project("isolated-haxe-home");
    const launcherEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined && entry[0] !== "HAXE_STD_PATH",
      ),
    );
    launcherEnvironment.HOME = isolatedHome;
    const extensionless = spawnSync(
      process.execPath,
      [
        cli,
        "watch",
        "--root",
        fixtureRoot,
        "--project-id",
        "extensionless-launcher-fixture",
        "--hxml",
        "build.hxml",
        "--output",
        "extensionless-launcher-gen/index.js",
        "--haxe",
        extensionlessLauncher,
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: launcherEnvironment,
        timeout: 30_000,
      },
    );
    assert.equal(extensionless.status, 2, extensionless.stderr);
    assert.equal(
      existsSync(launcherMarker),
      false,
      "an extensionless launcher must be rejected without being invoked",
    );
    assert.match(extensionless.stderr, /native Haxe 4\.3\.7 executable/u);
  }

  if (process.platform === "linux") {
    const pseudoElfMarker = path.join(fixtureRoot, "pseudo-elf-invoked");
    const pseudoElf = nativeFixture(
      "pseudo-elf-haxe",
      Buffer.concat([
        elfFixture().subarray(0, 20),
        Buffer.from(
          [
            "2>/dev/null",
            `printf invoked > ${JSON.stringify(pseudoElfMarker)}`,
            "printf '4.3.7\\n'",
            "",
          ].join("\n"),
          "utf8",
        ),
      ]),
    );
    assert.equal(
      inspectNativeExecutableFile(pseudoElf, "linux"),
      true,
      "the regression fixture must reach the raw-exec authority",
    );
    const isolatedHome = project("isolated-pseudo-elf-home");
    const pseudoElfEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined && entry[0] !== "HAXE_STD_PATH",
      ),
    );
    pseudoElfEnvironment.HOME = isolatedHome;
    const pseudoElfProbe = spawnSync(
      process.execPath,
      [
        cli,
        "watch",
        "--root",
        fixtureRoot,
        "--project-id",
        "pseudo-elf-fixture",
        "--hxml",
        "build.hxml",
        "--output",
        "pseudo-elf-gen/index.js",
        "--haxe",
        pseudoElf,
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: pseudoElfEnvironment,
        timeout: 30_000,
      },
    );
    assert.equal(pseudoElfProbe.status, 2, pseudoElfProbe.stderr);
    assert.equal(
      existsSync(pseudoElfMarker),
      false,
      "an admitted pseudo-ELF must not be interpreted by a shell",
    );
    assert.match(pseudoElfProbe.stderr, /ENOEXEC|execve|format/iu);
  }

  const linkedFixtureRoot = path.join(root, "linked-watch-root");
  symlinkSync(
    fixtureRoot,
    linkedFixtureRoot,
    process.platform === "win32" ? "junction" : "dir",
  );
  const linkedRoot = spawnSync(
    process.execPath,
    [
      cli,
      "watch",
      "--root",
      linkedFixtureRoot,
      "--project-id",
      "linked-root-fixture",
      "--hxml",
      "build.hxml",
      "--output",
      "linked-root-gen/index.js",
      "--haxe",
      process.execPath,
    ],
    { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(linkedRoot.status, 2, linkedRoot.stderr);
  assert.match(
    linkedRoot.stderr,
    /projectRoot must (?:be a real directory|not traverse a symbolic link)/u,
    "the CLI must reject root symlink evidence before probing tools or loading policy",
  );

  const intermediateTarget = project("intermediate-link-target");
  mkdirSync(path.join(intermediateTarget, "nested"));
  const intermediateLink = path.join(root, "intermediate-root-link");
  symlinkSync(
    intermediateTarget,
    intermediateLink,
    process.platform === "win32" ? "junction" : "dir",
  );
  const intermediateLinkedRoot = spawnSync(
    process.execPath,
    [
      cli,
      "watch",
      "--root",
      path.join(intermediateLink, "nested"),
      "--project-id",
      "intermediate-linked-root-fixture",
      "--hxml",
      "build.hxml",
      "--output",
      "linked-root-gen/index.js",
      "--haxe",
      process.execPath,
    ],
    { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(intermediateLinkedRoot.status, 2, intermediateLinkedRoot.stderr);
  assert.match(intermediateLinkedRoot.stderr, /must not traverse a symbolic link/u);

  const caseRoot = project("case-equivalent-root");
  const caseEquivalentRoot = path.join(
    path.dirname(caseRoot),
    path.basename(caseRoot).toUpperCase(),
  );
  if (caseEquivalentRoot !== caseRoot && existsSync(caseEquivalentRoot)) {
    const caseEquivalent = spawnSync(
      process.execPath,
      [
        cli,
        "watch",
        "--root",
        caseEquivalentRoot,
        "--project-id",
        "case-equivalent-root-fixture",
        "--hxml",
        "build.hxml",
        "--output",
        "case-equivalent-gen/index.js",
        "--haxe",
        process.execPath,
      ],
      { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(caseEquivalent.status, 2, caseEquivalent.stderr);
    assert.doesNotMatch(caseEquivalent.stderr, /symbolic link/u);
    assert.match(caseEquivalent.stderr, /requires Haxe 4\.3\.7/u);
  }

  const child = spawn(
    process.execPath,
    [
      cli,
      "watch",
      "--root",
      fixtureRoot,
      "--project-id",
      "plain-watch-fixture",
      "--hxml",
      "build.hxml",
      "--output",
      "src-gen/index.js",
      "--lix",
      "--json-lines",
    ],
    { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  const events: DevelopmentEvent<JsonValue>[] = [];
  const waiters = new Set<EventWaiter>();
  let stdout = "";
  let stderr = "";
  let streamFailure: Error | undefined;
  const rejectWaiters = (error: Error): void => {
    streamFailure = error;
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    waiters.clear();
  };
  const acceptEvent = (event: DevelopmentEvent<JsonValue>): void => {
    events.push(event);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(event)) continue;
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(event);
    }
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    while (stdout.includes("\n")) {
      const newline = stdout.indexOf("\n");
      const line = stdout.slice(0, newline);
      stdout = stdout.slice(newline + 1);
      if (line.length === 0) continue;
      try {
        const event = JSON.parse(line) as DevelopmentEvent<JsonValue>;
        assert.equal(event.protocol, "genes.tooling.development-session-event");
        assert.equal(event.version, 1);
        acceptEvent(event);
      } catch (error) {
        rejectWaiters(
          new Error(
            `JSON-lines stdout contained an invalid record ${JSON.stringify(line)}: ${String(error)}`,
          ),
        );
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exit = new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>(
    (resolve) => child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  const waitFor = async (
    predicate: (event: DevelopmentEvent<JsonValue>) => boolean,
    label: string,
  ): Promise<DevelopmentEvent<JsonValue>> => {
    if (streamFailure !== undefined) throw streamFailure;
    const existing = events.find(predicate);
    if (existing !== undefined) return existing;
    return await new Promise<DevelopmentEvent<JsonValue>>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(waiter);
        reject(
          new Error(
            `Timed out waiting for ${label}. stderr=${JSON.stringify(stderr)} events=${JSON.stringify(events.slice(-8))}`,
          ),
        );
      }, 180_000);
      const waiter: EventWaiter = { predicate, resolve, reject, timer };
      waiters.add(waiter);
    });
  };

  try {
    const initialFailure = await waitFor(
      (event) =>
        event.event.kind === "failed" &&
        event.event.failure.phase === "compile" &&
        event.event.failure.recoverable,
      "recoverable initial compile failure",
    );
    assert.match(
      JSON.stringify(
        initialFailure.event.kind === "failed"
          ? initialFailure.event.failure.diagnostic
          : null,
      ),
      /Main\.hx/u,
      "the first failure must come from the authored broken source",
    );
    assert.equal(
      events.some(
        (event) =>
          event.event.kind === "state" && event.event.state.kind === "blocked",
      ),
      true,
    );

    writeFileSync(main, validMain("ready-one"));
    const acceptedOne = await waitFor(
      (event) =>
        event.sequence > initialFailure.sequence &&
        event.event.kind === "generation-accepted" &&
        event.event.accepted.generation === 1,
      "first accepted generation",
    );
    const outputRoot = path.join(fixtureRoot, "src-gen");
    const firstDigest = treeDigest(outputRoot);

    writeFileSync(main, invalidMain());
    const laterFailure = await waitFor(
      (event) =>
        event.sequence > acceptedOne.sequence &&
        event.event.kind === "failed" &&
        event.event.failure.phase === "compile" &&
        event.event.failure.retained?.generation === 1,
      "degraded compile failure",
    );
    assert.equal(
      events.some(
        (event) =>
          event.sequence > acceptedOne.sequence &&
          event.sequence <= laterFailure.sequence &&
          event.event.kind === "state" &&
          event.event.state.kind === "degraded",
      ),
      true,
    );
    assert.equal(treeDigest(outputRoot), firstDigest);

    writeFileSync(main, validMain("ready-two"));
    await waitFor(
      (event) =>
        event.sequence > laterFailure.sequence &&
        event.event.kind === "generation-accepted" &&
        event.event.accepted.generation === 2,
      "second accepted generation",
    );
    assert.notEqual(treeDigest(outputRoot), firstDigest);
    const runtime = spawnSync(
      process.execPath,
      [path.join(outputRoot, "index.js")],
      { cwd: fixtureRoot, encoding: "utf8" },
    );
    assert.equal(runtime.status, 0, runtime.stderr);
    assert.match(runtime.stdout, /ready-two/u);

    const started = events.find(
      (event) =>
        event.event.kind === "compiler-lifecycle" &&
        event.event.event.kind === "started",
    );
    assert.notEqual(started, undefined, "the CLI must own one reusable Haxe server");
    assert.equal(
      events.filter(
        (event) =>
          event.event.kind === "compiler-lifecycle" &&
          event.event.event.kind === "started",
      ).length,
      1,
      "all repaired revisions must reuse one owned Haxe server",
    );
    const port =
      started?.event.kind === "compiler-lifecycle" &&
      started.event.event.kind === "started"
        ? started.event.event.endpoint.port
        : -1;
    assert.equal(child.kill("SIGTERM"), true);
    const closed = await exit;
    assert.deepEqual(closed, { code: 143, signal: null });
    assert.match(stderr, /Haxe-only admission \(no host validator\)/u);
    assert.equal(stdout, "", "JSON-lines output must end at a record boundary");
    assert.equal(await portClosed(port), true, "the owned Haxe server port must close");

    const humanStates = events
      .map((event) => formatWatchEvent(event))
      .filter((line): line is string => line !== null);
    for (const state of ["BUILDING", "BLOCKED", "READY", "DEGRADED", "CLOSING", "CLOSED"]) {
      assert.equal(
        humanStates.some((line) => line.startsWith(state)),
        true,
        `human output omitted ${state}`,
      );
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }

  const disconnectedOutput = spawn(
    process.execPath,
    [
      cli,
      "watch",
      "--root",
      fixtureRoot,
      "--project-id",
      "disconnected-output-fixture",
      "--hxml",
      "build.hxml",
      "--output",
      "disconnected-output-gen/index.js",
      "--state",
      ".genes/disconnected-output-state",
      "--lix",
      "--json-lines",
    ],
    { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  disconnectedOutput.stdout.setEncoding("utf8");
  disconnectedOutput.stderr.setEncoding("utf8");
  let disconnectedBuffer = "";
  let disconnectedStderr = "";
  let disconnectedPort = -1;
  disconnectedOutput.stderr.on("data", (chunk: string) => {
    disconnectedStderr += chunk;
  });
  const disconnectedStarted = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for the disconnected-output server. stderr=${JSON.stringify(disconnectedStderr)}`,
        ),
      );
    }, 180_000);
    disconnectedOutput.stdout.on("data", (chunk: string) => {
      disconnectedBuffer += chunk;
      while (disconnectedBuffer.includes("\n")) {
        const newline = disconnectedBuffer.indexOf("\n");
        const line = disconnectedBuffer.slice(0, newline);
        disconnectedBuffer = disconnectedBuffer.slice(newline + 1);
        if (line.length === 0) continue;
        const event = JSON.parse(line) as DevelopmentEvent<JsonValue>;
        if (
          event.event.kind !== "compiler-lifecycle" ||
          event.event.event.kind !== "started"
        ) {
          continue;
        }
        clearTimeout(timer);
        disconnectedPort = event.event.event.endpoint.port;
        disconnectedOutput.stdout.destroy();
        resolve();
        return;
      }
    });
  });
  const disconnectedExit = new Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>((resolve) =>
    disconnectedOutput.once("exit", (code, signal) => resolve({ code, signal })),
  );
  let disconnectedExitTimer: NodeJS.Timeout | undefined;
  try {
    await disconnectedStarted;
    const closed = await Promise.race([
      disconnectedExit,
      new Promise<never>((_resolve, reject) => {
        disconnectedExitTimer = setTimeout(
          () => reject(new Error("Disconnected stdout did not close the session.")),
          180_000,
        );
      }),
    ]);
    clearTimeout(disconnectedExitTimer);
    disconnectedExitTimer = undefined;
    assert.deepEqual(closed, { code: 0, signal: null }, disconnectedStderr);
    assert.equal(
      await portClosed(disconnectedPort),
      true,
      "stdout disconnection must close the owned Haxe server",
    );
  } finally {
    clearTimeout(disconnectedExitTimer);
    if (
      disconnectedOutput.exitCode === null &&
      disconnectedOutput.signalCode === null
    ) {
      disconnectedOutput.kill("SIGKILL");
    }
  }

  writeFileSync(
    path.join(fixtureRoot, "invalid-result.mjs"),
    [
      "export default {",
      "  policyFacts: { fixture: 'invalid-result' },",
      "  async validate() { return { ok: true, unexpected: true }; },",
      "};",
      "",
    ].join("\n"),
  );
  const invalidValidator = spawnSync(
    process.execPath,
    [
      cli,
      "watch",
      "--root",
      fixtureRoot,
      "--project-id",
      "invalid-validator-fixture",
      "--hxml",
      "build.hxml",
      "--output",
      "invalid-validator-gen/index.js",
      "--state",
      ".genes/invalid-validator-state",
      "--validator",
      "invalid-result.mjs",
      "--lix",
      "--json-lines",
    ],
    { cwd: repositoryRoot, encoding: "utf8", timeout: 180_000 },
  );
  assert.equal(invalidValidator.status, 2, invalidValidator.stderr);
  assert.match(
    invalidValidator.stdout,
    /GENES_WATCH_VALIDATOR_RESULT_INVALID/u,
    "a structural validator result failure must remain machine-readable",
  );
  const invalidValidatorEvents = invalidValidator.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DevelopmentEvent<JsonValue>);
  const invalidValidatorStarted = invalidValidatorEvents.find(
    (event) =>
      event.event.kind === "compiler-lifecycle" &&
      event.event.event.kind === "started",
  );
  const invalidValidatorPort =
    invalidValidatorStarted?.event.kind === "compiler-lifecycle" &&
    invalidValidatorStarted.event.event.kind === "started"
      ? invalidValidatorStarted.event.event.endpoint.port
      : -1;
  assert.notEqual(invalidValidatorPort, -1);
  assert.equal(
    await portClosed(invalidValidatorPort),
    true,
    "invalid validator setup must still close the owned Haxe server",
  );

  writeFileSync(
    path.join(fixtureRoot, "colliding-result.mjs"),
    [
      "export default {",
      "  policyFacts: { fixture: 'colliding-result' },",
      "  async validate() {",
      "    return {",
      "      ok: false,",
      "      diagnostic: {",
      "        protocol: 'genes.tooling.watch-validation',",
      "        version: 1,",
      "        code: 'GENES_WATCH_VALIDATOR_RESULT_INVALID',",
      "        message: 'caller-owned diagnostic',",
      "      },",
      "    };",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  const collidingValidator = spawn(
    process.execPath,
    [
      cli,
      "watch",
      "--root",
      fixtureRoot,
      "--project-id",
      "colliding-validator-fixture",
      "--hxml",
      "build.hxml",
      "--output",
      "colliding-validator-gen/index.js",
      "--state",
      ".genes/colliding-validator-state",
      "--validator",
      "colliding-result.mjs",
      "--lix",
      "--json-lines",
    ],
    { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  collidingValidator.stdout.setEncoding("utf8");
  collidingValidator.stderr.setEncoding("utf8");
  let collidingBuffer = "";
  let collidingStderr = "";
  let collidingPort = -1;
  collidingValidator.stderr.on("data", (chunk: string) => {
    collidingStderr += chunk;
  });
  const collidingRejected = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `Timed out waiting for the caller-owned validator rejection. stderr=${JSON.stringify(collidingStderr)}`,
          ),
        ),
      180_000,
    );
    collidingValidator.stdout.on("data", (chunk: string) => {
      collidingBuffer += chunk;
      while (collidingBuffer.includes("\n")) {
        const newline = collidingBuffer.indexOf("\n");
        const line = collidingBuffer.slice(0, newline);
        collidingBuffer = collidingBuffer.slice(newline + 1);
        if (line.length === 0) continue;
        const event = JSON.parse(line) as DevelopmentEvent<JsonValue>;
        if (
          event.event.kind === "compiler-lifecycle" &&
          event.event.event.kind === "started"
        ) {
          collidingPort = event.event.event.endpoint.port;
        }
        if (
          event.event.kind !== "failed" ||
          event.event.failure.phase !== "validate"
        ) {
          continue;
        }
        clearTimeout(timer);
        assert.notEqual(collidingPort, -1);
        assert.equal(collidingValidator.kill("SIGTERM"), true);
        resolve();
        return;
      }
    });
  });
  const collidingExit = new Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>((resolve) =>
    collidingValidator.once("exit", (code, signal) => resolve({ code, signal })),
  );
  try {
    await collidingRejected;
    assert.deepEqual(await collidingExit, { code: 143, signal: null }, collidingStderr);
    assert.equal(
      await portClosed(collidingPort),
      true,
      "a caller-owned marker-shaped rejection must remain recoverable and close on signal",
    );
  } finally {
    if (
      collidingValidator.exitCode === null &&
      collidingValidator.signalCode === null
    ) {
      collidingValidator.kill("SIGKILL");
    }
  }

  writeFileSync(path.join(fixtureRoot, "fatal.hxml"), "--cmd=echo forbidden\n");
  const fatal = spawnSync(
    process.execPath,
    [
      cli,
      "watch",
      "--root",
      fixtureRoot,
      "--project-id",
      "fatal-watch-fixture",
      "--hxml",
      "fatal.hxml",
      "--output",
      "fatal-gen/index.js",
      "--json-lines",
    ],
    { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(fatal.status, 1, fatal.stderr);
  const fatalEvents = fatal.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DevelopmentEvent<JsonValue>);
  assert.equal(
    fatalEvents.some(
      (event) =>
        event.event.kind === "failed" && !event.event.failure.recoverable,
    ),
    true,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(watchFixtureRoot, { recursive: true, force: true });
}

process.stdout.write("genes-watch-cli:ok\n");
