import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import path from "node:path";

import {
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
      "  value: process.env.GENES_LAUNCH_VALUE",
      "}));",
    ].join("\n");
    const result = await captured(
      process.execPath,
      ["--input-type=module", "--eval", reporter],
      root,
      { GENES_LAUNCH_VALUE: "exact environment" },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      pid: result.pid,
      argv0: process.execPath,
      cwd: root,
      value: "exact environment",
    });

    if (process.platform !== "win32") {
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
      assert.notEqual(rejected.status, 0);
      assert.equal(
        existsSync(shellMarker),
        false,
        "ENOEXEC must not reinterpret the target through a shell",
      );
      assert.match(rejected.stderr, /raw exec|execve|format/iu);

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
