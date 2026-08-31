import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HAXE_ENVIRONMENT_PAYLOAD_LIMIT,
  HAXE_ENVIRONMENT_TEXT_LIMIT,
} from "./session/haxe-exec-contract.js";
import {
  createRawExecControl,
  launchHaxe,
  runHaxeSync,
} from "./session/haxe-launch.js";
import { HaxeSessionCompiler } from "./session/haxe-driver.js";
import {
  HAXE_4_3_7_DEVELOPMENT_JS_POLICY,
  type BoundHaxeInvocation,
} from "./session/effective-invocation.js";
import { resolveSessionLayout } from "./session/layout.js";

async function captured(
  executable: string,
  args: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>>,
): Promise<{
  readonly pid: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}> {
  const launch = launchHaxe(executable, args, {
    cwd,
    environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.notEqual(launch.child.pid, undefined);
  assert.notEqual(launch.child.stdout, null);
  assert.notEqual(launch.child.stderr, null);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  launch.child.stdout!.on("data", (chunk: Buffer) => stdout.push(chunk));
  launch.child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk));
  const closed = once(launch.child, "close");
  await launch.handoff;
  const [code] = await closed;
  return Object.freeze({
    pid: launch.child.pid!,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
    code: code as number | null,
  });
}

function compilerInvocation(
  executable: string,
  root: string,
  environment: Readonly<Record<string, string>> = Object.freeze({}),
): BoundHaxeInvocation {
  const sourceInvocation = Object.freeze({
    executable,
    cwd: root,
    args: Object.freeze(["build.hxml"]),
    ioPolicy: HAXE_4_3_7_DEVELOPMENT_JS_POLICY,
    env: environment,
    compatibilityFacts: Object.freeze({}),
  });
  return Object.freeze({
    sourceInvocation,
    executable,
    cwd: root,
    environment,
    arguments: Object.freeze([]),
    privateArgumentFiles: Object.freeze([]),
    candidateRoot: path.join(root, "candidate"),
    candidateOutputFile: path.join(root, "candidate", "app.js"),
  });
}

async function main(): Promise<void> {
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-haxe-launch-")),
  );
  try {
    const reporter = [
      "process.stdout.write(JSON.stringify({",
      "  pid: process.pid,",
      "  argv0: process.argv0,",
      "  cwd: process.cwd(),",
      "  value: process.env.GENES_LAUNCH_VALUE,",
      "  prototypeValue: process.env.__proto__",
      "}));",
    ].join("\n");
    const result = await captured(
      process.execPath,
      ["--input-type=module", "--eval", reporter],
      root,
      Object.fromEntries([
        ["GENES_LAUNCH_VALUE", "exact environment"],
        ["__proto__", "exact prototype value"],
      ]),
    );
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      pid: result.pid,
      argv0: process.execPath,
      cwd: root,
      value: "exact environment",
      prototypeValue: "exact prototype value",
    });

    if (process.platform !== "win32") {
      const runner = fileURLToPath(
        new URL("./session/haxe-exec-runner.js", import.meta.url),
      );
      const deepTempDirectory = path.join(
        root,
        "deep-temp",
        "x".repeat(80),
        "y".repeat(80),
      );
      mkdirSync(deepTempDirectory, { recursive: true });
      const previousTempDirectory = process.env.TMPDIR;
      try {
        process.env.TMPDIR = deepTempDirectory;
        const deepTempResult = await captured(
          process.execPath,
          ["--eval", ""],
          root,
          {},
        );
        assert.equal(
          deepTempResult.code,
          0,
          "a long TMPDIR must not exceed the POSIX control-socket path limit",
        );
      } finally {
        if (previousTempDirectory === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = previousTempDirectory;
      }

      assert.throws(
        () => launchHaxe(process.execPath, ["--version"], {
          cwd: root,
          environment: {
            OVERSIZED_ENVIRONMENT: "x".repeat(
              HAXE_ENVIRONMENT_TEXT_LIMIT + 1,
            ),
          },
          stdout: "pipe",
          stderr: "pipe",
        }),
        /environment exceeds its text byte limit/u,
      );

      const oversizedCredential = "must-not-appear-after-overflow";
      const oversized = spawnSync(
        process.execPath,
        [
          runner,
          "-",
          String(HAXE_ENVIRONMENT_PAYLOAD_LIMIT + 1),
          process.execPath,
          "--version",
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: {},
          input: JSON.stringify({
            GENES_SYNTHETIC_CREDENTIAL: oversizedCredential,
          }),
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const oversizedDiagnostic = oversized.stderr;
      assert.equal(oversized.status, 126, oversizedDiagnostic);
      assert.equal(oversized.signal, null, oversizedDiagnostic);
      assert.match(oversizedDiagnostic, /byte limit/u);
      assert.doesNotMatch(
        oversizedDiagnostic,
        new RegExp(oversizedCredential, "u"),
      );

      const absentControlMarker = path.join(root, "absent-control-ran");
      const absentControl = spawnSync(
        process.execPath,
        [
          runner,
          path.join(root, "missing-control.sock"),
          "2",
          process.execPath,
          "--eval",
          'require("node:fs").writeFileSync(process.argv[1], "ran")',
          absentControlMarker,
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: {},
          input: "{}",
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      assert.equal(absentControl.status, 126, absentControl.stderr);
      assert.equal(absentControl.signal, null, absentControl.stderr);
      assert.match(absentControl.stderr, /control is unavailable/u);
      assert.equal(
        existsSync(absentControlMarker),
        false,
        "the target must not start without READY publication",
      );

      const longLaunch = launchHaxe("/bin/sleep", ["10"], {
        cwd: root,
        environment: {},
        stdout: "ignore",
        stderr: "pipe",
      });
      const longClosed = once(longLaunch.child, "close");
      let timeout: NodeJS.Timeout | undefined;
      const handoffTimeout = new Promise<string>((resolve) => {
        timeout = setTimeout(() => resolve("timeout"), 3_000);
      });
      assert.equal(
        await Promise.race([
          longLaunch.handoff.then(() => "handoff"),
          handoffTimeout,
        ]),
        "handoff",
        "successful exec must close its private control before the target exits",
      );
      clearTimeout(timeout);
      assert.equal(longLaunch.child.exitCode, null);
      longLaunch.child.kill();
      await longClosed;

      const interruptedMarker = path.join(root, "interrupted-control-ran");
      const interruptedChild = spawn(
        process.execPath,
        [
          "--eval",
          'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "ran"), 250)',
          interruptedMarker,
        ],
        {
          cwd: root,
          env: {},
          shell: false,
          stdio: ["pipe", "ignore", "ignore"],
        },
      );
      const interruptedControl = createRawExecControl();
      const interruptedHandoff = interruptedControl.handoff(interruptedChild);
      const interruptedSocket = net.createConnection(interruptedControl.path);
      await once(interruptedSocket, "connect");
      interruptedSocket.end("INVALID\n");
      const interruptedClosed = once(interruptedChild, "close");
      await assert.rejects(
        interruptedHandoff,
        /did not confirm raw exec/u,
      );
      await interruptedClosed;
      assert.equal(
        existsSync(interruptedMarker),
        false,
        "a rejected parent handoff must terminate the target",
      );

      const missingHaxe = path.join(root, "missing-haxe");
      const missingLaunch = launchHaxe(missingHaxe, ["--version"], {
        cwd: root,
        environment: {
          GENES_SYNTHETIC_CREDENTIAL: "must-not-appear-in-diagnostics",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      assert.notEqual(missingLaunch.child.stderr, null);
      const missingStderr: Buffer[] = [];
      missingLaunch.child.stderr!.on("data", (chunk: Buffer) => {
        missingStderr.push(chunk);
      });
      const missingClosed = once(missingLaunch.child, "close");
      await assert.rejects(missingLaunch.handoff, /ENOENT|no such file/iu);
      const [missingCode, missingSignal] = await missingClosed;
      const missingDiagnostic = Buffer.concat(missingStderr).toString("utf8");
      assert.equal(missingCode, 126, missingDiagnostic);
      assert.equal(missingSignal, null, missingDiagnostic);
      assert.doesNotMatch(missingDiagnostic, /must-not-appear-in-diagnostics/u);

      const invalidCredential = "must-not-appear-in-validation-diagnostics";
      const invalidLaunch = launchHaxe("/bin/echo", ["unused"], {
        cwd: root,
        environment: {
          GENES_SYNTHETIC_CREDENTIAL: invalidCredential,
          INVALID_ENVIRONMENT: "nul\0byte",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      assert.notEqual(invalidLaunch.child.stderr, null);
      const invalidStderr: Buffer[] = [];
      invalidLaunch.child.stderr!.on("data", (chunk: Buffer) => {
        invalidStderr.push(chunk);
      });
      const invalidClosed = once(invalidLaunch.child, "close");
      let invalidHandoffDiagnostic = "";
      try {
        await invalidLaunch.handoff;
        assert.fail(
          "a NUL-bearing environment must reject the raw-exec handoff",
        );
      } catch (error) {
        invalidHandoffDiagnostic = error instanceof Error
          ? error.message
          : String(error);
      }
      const [invalidCode, invalidSignal] = await invalidClosed;
      const invalidProcessDiagnostic = Buffer.concat(invalidStderr).toString(
        "utf8",
      );
      assert.equal(invalidCode, 126, invalidProcessDiagnostic);
      assert.equal(invalidSignal, null, invalidProcessDiagnostic);
      assert.match(invalidHandoffDiagnostic, /NUL bytes/u);
      assert.doesNotMatch(
        invalidHandoffDiagnostic,
        new RegExp(invalidCredential, "u"),
      );
      assert.doesNotMatch(
        invalidProcessDiagnostic,
        new RegExp(invalidCredential, "u"),
      );

      const preloadMarker = path.join(root, "node-options-ran");
      const preload = path.join(root, "preload.cjs");
      writeFileSync(
        preload,
        `require("node:fs").writeFileSync(${JSON.stringify(preloadMarker)}, "ran");\n`,
        "utf8",
      );
      const echo = await captured(
        "/bin/echo",
        ["raw exec"],
        root,
        { NODE_OPTIONS: `--require=${preload}` },
      );
      assert.equal(echo.code, 0, echo.stderr);
      assert.equal(echo.stdout, "raw exec\n");
      assert.equal(
        existsSync(preloadMarker),
        false,
        "the Node handoff must not evaluate Haxe's NODE_OPTIONS",
      );

      const shellMarker = path.join(root, "shell-fallback-ran");
      const pseudoNative = path.join(root, "pseudo-native");
      writeFileSync(
        pseudoNative,
        `echo ran > ${JSON.stringify(shellMarker)}\necho 4.3.7\n`,
        "utf8",
      );
      chmodSync(pseudoNative, 0o755);
      const fallbackControl = spawnSync(pseudoNative, ["--version"], {
        cwd: root,
        encoding: "utf8",
        env: {},
        shell: false,
      });
      if (fallbackControl.status === 0) {
        assert.equal(
          existsSync(shellMarker),
          true,
          "a platform shell fallback must run the control fixture",
        );
        unlinkSync(shellMarker);
      } else {
        assert.equal(
          fallbackControl.error !== undefined && "code" in fallbackControl.error
            ? fallbackControl.error.code
            : undefined,
          "ENOEXEC",
          fallbackControl.stderr,
        );
        assert.equal(existsSync(shellMarker), false);
      }
      const rejected = runHaxeSync(pseudoNative, ["--version"], {
        cwd: root,
        environment: {},
      });
      assert.equal(rejected.status, 126, rejected.stderr);
      assert.equal(rejected.signal, null, rejected.stderr);
      assert.equal(
        existsSync(shellMarker),
        false,
        "ENOEXEC must not reinterpret the target through a shell",
      );
      assert.match(rejected.stderr, /ENOEXEC|execve|format/iu);

      const layout = resolveSessionLayout(
        root,
        "haxe-launch-test",
        "dist/app.js",
        ".genes/state",
      );
      mkdirSync(path.join(root, path.dirname(layout.serverLeaseRelative)), {
        recursive: true,
      });
      const rejectedCompiler = new HaxeSessionCompiler(layout, () => {}, 250);
      try {
        await assert.rejects(
          rejectedCompiler.compile(
            compilerInvocation(pseudoNative, root),
            "invalid-executable",
            new AbortController().signal,
          ),
          /execve|format/iu,
        );
        assert.equal(
          existsSync(shellMarker),
          false,
          "a fast handoff failure must win over child close",
        );
      } finally {
        await rejectedCompiler.close();
      }

      const handoffRejectedCompiler = new HaxeSessionCompiler(
        layout,
        () => {},
        250,
      );
      try {
        await assert.rejects(
          handoffRejectedCompiler.compile(
            compilerInvocation(
              "/bin/echo",
              root,
              Object.freeze({ INVALID_ENVIRONMENT: "nul\0byte" }),
            ),
            "invalid-environment",
            new AbortController().signal,
          ),
          /raw-exec failed/iu,
        );
      } finally {
        await handoffRejectedCompiler.close();
      }

      const missingWorkingDirectory = path.join(root, "missing-working-dir");
      const missingWorkingDirectoryCompiler = new HaxeSessionCompiler(
        layout,
        () => {},
        250,
      );
      try {
        await assert.rejects(
          missingWorkingDirectoryCompiler.compile(
            compilerInvocation(process.execPath, missingWorkingDirectory),
            "missing-working-directory",
            new AbortController().signal,
          ),
          /ENOENT|no such file/iu,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
      } finally {
        await missingWorkingDirectoryCompiler.close();
      }

      const launchMarker = path.join(root, "stale-server-launched");
      const fakeHaxe = path.join(root, "fake-haxe");
      writeFileSync(
        fakeHaxe,
        [
          "#!/usr/bin/env node",
          `require("node:fs").writeFileSync(${JSON.stringify(launchMarker)}, "launched");`,
        ].join("\n"),
        "utf8",
      );
      chmodSync(fakeHaxe, 0o755);
      const compiler = new HaxeSessionCompiler(layout, () => {}, 250);
      try {
        await assert.rejects(
          compiler.compile(
            compilerInvocation(fakeHaxe, root),
            "stale-invocation",
            new AbortController().signal,
            () => {
              throw new Error("the Haxe invocation became stale");
            },
          ),
          /invocation became stale/u,
        );
        assert.equal(
          existsSync(launchMarker),
          false,
          "the executable must not start before its current-invocation guard",
        );
      } finally {
        await compiler.close();
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
