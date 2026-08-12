import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { inventoryHxml, type HxmlLibraryRequest } from "./hxml/index.js";
import {
  LixLibraryResolverError,
  resolveLixLibraryGroup,
  type LixLibraryResolverFailureCode,
} from "./lix/index.js";

const root = mkdtempSync(path.join(os.tmpdir(), "genes-lix-resolver-"));
const projectRoot = path.join(root, "project");
const libraryRoot = path.join(root, "libraries");
const firstSource = path.join(libraryRoot, "first", "src");
const secondSource = path.join(libraryRoot, "second", "src");
const spacedLibraryRoot = path.join(libraryRoot, "with spaces");
const spacedSource = path.join(spacedLibraryRoot, "src");
mkdirSync(path.join(projectRoot, "haxe_libraries"), { recursive: true });
mkdirSync(firstSource, { recursive: true });
mkdirSync(secondSource, { recursive: true });
mkdirSync(spacedSource, { recursive: true });
writeFileSync(path.join(libraryRoot, "first", "haxelib.json"), '{"name":"first"}\n', "utf8");
writeFileSync(path.join(libraryRoot, "second", "haxelib.json"), '{"name":"second"}\n', "utf8");
writeFileSync(path.join(spacedLibraryRoot, "haxelib.json"), '{"name":"with-spaces"}\n', "utf8");

for (const name of ["first", "second"]) {
  writeFileSync(
    path.join(projectRoot, "haxe_libraries", `${name}.hxml`),
    `# pinned ${name} scope\n`,
    "utf8",
  );
}
writeFileSync(
  path.join(projectRoot, "build.hxml"),
  "-lib first\n-lib second\n",
  "utf8",
);

const program = path.join(root, "fake-haxelib.cjs");
writeFileSync(
  program,
  [
    'const expected = ["path", "first", "second"];',
    'if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) process.exit(23);',
    `process.stdout.write(${JSON.stringify([
      firstSource,
      "-D first=1.0.0",
      "--macro setup('with space')",
      secondSource,
      "-D second=2.0.0",
      "",
    ].join("\n"))});`,
    "",
  ].join("\n"),
  "utf8",
);
chmodSync(program, 0o755);

function fakeProgram(name: string, source: string): string {
  const file = path.join(root, `${name}.cjs`);
  writeFileSync(file, `${source}\n`, "utf8");
  chmodSync(file, 0o755);
  return file;
}

async function expectCode(
  action: () => Promise<unknown>,
  code: LixLibraryResolverFailureCode,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.equal(error instanceof LixLibraryResolverError, true);
    assert.equal((error as LixLibraryResolverError).code, code);
    return true;
  });
}

function request(name: string): HxmlLibraryRequest {
  return Object.freeze({
    request: name,
    name,
    version: null,
    fromFile: path.join(projectRoot, "build.hxml"),
    workingDirectory: projectRoot,
  });
}

const result = await resolveLixLibraryGroup({
  projectRoot,
  requests: [request("first"), request("second")],
  command: {
    executable: process.execPath,
    argsPrefix: [program],
  },
});

const canonical = (value: string): string => realpathSync.native(value);
const sorted = (values: readonly string[]): readonly string[] =>
  [...values].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));

const delayedWriterProgram = fakeProgram(
  "delayed-writer",
  'setTimeout(() => process.stdout.write(process.env.DELAYED_OUTPUT + "\\n"), 80);',
);
const delayedOutputProgram = fakeProgram(
  "delayed-output",
  [
    'const { spawn } = require("node:child_process");',
    "const child = spawn(process.execPath, [process.env.DELAYED_WRITER], { stdio: [\"ignore\", 1, 2] });",
    "child.unref();",
  ].join("\n"),
);
const delayedOutput = await resolveLixLibraryGroup({
  projectRoot,
  requests: [request("first")],
  command: {
    executable: process.execPath,
    argsPrefix: [delayedOutputProgram],
    environment: {
      DELAYED_OUTPUT: firstSource,
      DELAYED_WRITER: delayedWriterProgram,
    },
  },
});
assert.deepEqual(delayedOutput.arguments, ["-cp", canonical(firstSource)]);

const crlfOutputProgram = fakeProgram(
  "crlf-output",
  `process.stdout.write(${JSON.stringify(`${firstSource}\r\n-D crlf=1\r\n`)});`,
);
const crlfOutput = await resolveLixLibraryGroup({
  projectRoot,
  requests: [request("first")],
  command: {
    executable: process.execPath,
    argsPrefix: [crlfOutputProgram],
  },
});
assert.deepEqual(crlfOutput.arguments, [
  "-cp",
  canonical(firstSource),
  "-D",
  "crlf=1",
]);

const inlineClassPathProgram = fakeProgram(
  "inline-class-path",
  `process.stdout.write(${JSON.stringify(`--class-path=${firstSource}\n`)});`,
);
const inlineClassPath = await resolveLixLibraryGroup({
  projectRoot,
  requests: [request("first")],
  command: {
    executable: process.execPath,
    argsPrefix: [inlineClassPathProgram],
  },
});
assert.deepEqual(inlineClassPath.arguments, ["-cp", canonical(firstSource)]);
assert.deepEqual(inlineClassPath.allowedRoots, [
  canonical(path.join(libraryRoot, "first")),
]);

const quotedClassPathProgram = fakeProgram(
  "quoted-class-path",
  `process.stdout.write(${JSON.stringify(`-cp "${spacedSource}"\n`)});`,
);
const quotedClassPath = await resolveLixLibraryGroup({
  projectRoot,
  requests: [request("first")],
  command: {
    executable: process.execPath,
    argsPrefix: [quotedClassPathProgram],
  },
});
assert.deepEqual(quotedClassPath.arguments, ["-cp", canonical(spacedSource)]);
assert.deepEqual(quotedClassPath.allowedRoots, [canonical(spacedLibraryRoot)]);

const firstNekoLibrary = path.join(libraryRoot, "first", "ndll");
mkdirSync(firstNekoLibrary);
const nekoLibraryOutputProgram = fakeProgram(
  "neko-library-output",
  `process.stdout.write(${JSON.stringify(`-L ${firstNekoLibrary}\n`)});`,
);
writeFileSync(
  path.join(projectRoot, "neko-library.hxml"),
  "-lib first\n",
  "utf8",
);
const nekoLibraryInventory = await inventoryHxml({
  entryFiles: ["neko-library.hxml"],
  workingDirectory: projectRoot,
  allowedRoots: [projectRoot],
  resolveLibraries: (requests, context) =>
    resolveLixLibraryGroup({
      projectRoot,
      requests,
      command: {
        executable: process.execPath,
        argsPrefix: [nekoLibraryOutputProgram],
      },
      signal: context.signal,
    }),
});
assert.deepEqual(nekoLibraryInventory.effectiveArguments, [
  "--neko-lib-path",
  canonical(firstNekoLibrary),
]);

writeFileSync(
  path.join(projectRoot, "lix-extra.hxml"),
  "-D via-lix-hxml=1\n",
  "utf8",
);
const hxmlOutputProgram = fakeProgram(
  "hxml-output",
  'process.stdout.write("lix-extra.hxml\\n");',
);
const hxmlInventory = await inventoryHxml({
  entryFiles: ["build.hxml"],
  workingDirectory: projectRoot,
  allowedRoots: [projectRoot],
  resolveLibraries: (requests, context) =>
    resolveLixLibraryGroup({
      projectRoot,
      requests,
      command: {
        executable: process.execPath,
        argsPrefix: [hxmlOutputProgram],
      },
      signal: context.signal,
    }),
});
assert.deepEqual(hxmlInventory.effectiveArguments, [
  "-D",
  "via-lix-hxml=1",
]);
assert.equal(
  hxmlInventory.hxmlFiles.includes(canonical(path.join(projectRoot, "lix-extra.hxml"))),
  true,
);

const linkedPackageRoot = path.join(root, "linked-package");
symlinkSync(path.join(libraryRoot, "first"), linkedPackageRoot, "dir");
await expectCode(
  () =>
    resolveLixLibraryGroup({
      projectRoot,
      requests: [request("first")],
      command: {
        executable: process.execPath,
        argsPrefix: [
          fakeProgram(
            "linked-output",
            `process.stdout.write(${JSON.stringify(path.join(linkedPackageRoot, "src") + "\n")});`,
          ),
        ],
      },
    }),
  "LIX_RESOLVER_UNSAFE_LIBRARY",
);

assert.deepEqual(result.arguments, [
  "-cp",
  canonical(firstSource),
  "-D",
  "first=1.0.0",
  "--macro",
  "setup('with space')",
  "-cp",
  canonical(secondSource),
  "-D",
  "second=2.0.0",
]);
assert.deepEqual(
  result.provenanceFiles,
  sorted([
    canonical(path.join(projectRoot, "haxe_libraries", "first.hxml")),
    canonical(path.join(projectRoot, "haxe_libraries", "second.hxml")),
    canonical(path.join(libraryRoot, "first", "haxelib.json")),
    canonical(path.join(libraryRoot, "second", "haxelib.json")),
  ]),
);
assert.deepEqual(result.allowedRoots, [
  canonical(path.join(libraryRoot, "first")),
  canonical(path.join(libraryRoot, "second")),
]);

const inventory = await inventoryHxml({
  entryFiles: ["build.hxml"],
  workingDirectory: projectRoot,
  allowedRoots: [projectRoot],
  resolveLibraries: (requests, context) =>
    resolveLixLibraryGroup({
      projectRoot,
      requests,
      command: {
        executable: process.execPath,
        argsPrefix: [program],
      },
      signal: context.signal,
    }),
});
assert.deepEqual(inventory.effectiveArguments, result.arguments);
assert.deepEqual(
  inventory.allowedRoots,
  sorted([canonical(projectRoot), ...result.allowedRoots]),
);
assert.deepEqual(inventory.libraryProvenanceFiles, result.provenanceFiles);

await assert.rejects(
  resolveLixLibraryGroup({
    projectRoot,
    requests: [request("missing")],
    command: {
      executable: process.execPath,
      argsPrefix: [program],
    },
  }),
  /scope file.*missing/u,
);

await expectCode(
  () =>
    resolveLixLibraryGroup({
      projectRoot,
      requests: [{ ...request("first"), request: "--help" }],
      command: {
        executable: process.execPath,
        argsPrefix: [program],
      },
    }),
  "LIX_RESOLVER_INVALID_OPTIONS",
);

await expectCode(
  () =>
    resolveLixLibraryGroup({
      projectRoot,
      requests: [request("first")],
      command: {
        executable: process.execPath,
        argsPrefix: [
          fakeProgram(
            "relative-output",
            'process.stdout.write("relative/src\\n");',
          ),
        ],
      },
    }),
  "LIX_RESOLVER_UNSAFE_LIBRARY",
);

await expectCode(
  () =>
    resolveLixLibraryGroup({
      projectRoot,
      requests: [request("first")],
      command: {
        executable: process.execPath,
        argsPrefix: [
          fakeProgram(
            "failed-command",
            'process.stderr.write("failed\\n"); process.exit(7);',
          ),
        ],
      },
    }),
  "LIX_RESOLVER_COMMAND_FAILED",
);

await expectCode(
  () =>
    resolveLixLibraryGroup({
      projectRoot,
      requests: [request("first")],
      command: {
        executable: process.execPath,
        argsPrefix: [
          fakeProgram(
            "large-output",
            'process.stdout.write("x".repeat(128));',
          ),
        ],
      },
      maxOutputBytes: 32,
    }),
  "LIX_RESOLVER_OUTPUT_TOO_LARGE",
);

const cancelled = new AbortController();
cancelled.abort();
await expectCode(
  () =>
    resolveLixLibraryGroup({
      projectRoot,
      requests: [request("first")],
      command: {
        executable: process.execPath,
        argsPrefix: [program],
      },
      signal: cancelled.signal,
    }),
  "LIX_RESOLVER_ABORTED",
);

if (process.platform !== "win32") {
  const firstManifest = path.join(libraryRoot, "first", "haxelib.json");
  chmodSync(firstManifest, 0o000);
  try {
    await expectCode(
      () =>
        resolveLixLibraryGroup({
          projectRoot,
          requests: [request("first")],
          command: {
            executable: process.execPath,
            argsPrefix: [
              fakeProgram(
                "unreadable-proof",
                `process.stdout.write(${JSON.stringify(`${firstSource}\n`)});`,
              ),
            ],
          },
        }),
      "LIX_RESOLVER_UNSAFE_LIBRARY",
    );
  } finally {
    chmodSync(firstManifest, 0o644);
  }
}

const disappearingScope = path.join(
  projectRoot,
  "haxe_libraries",
  "first.hxml",
);
try {
  await expectCode(
    () =>
      resolveLixLibraryGroup({
        projectRoot,
        requests: [request("first")],
        command: {
          executable: process.execPath,
          argsPrefix: [
            fakeProgram(
              "removed-scope-proof",
              [
                'const fs = require("node:fs");',
                "fs.unlinkSync(process.env.SCOPE_FILE);",
                "process.stdout.write(process.env.LIBRARY_SOURCE + '\\n');",
              ].join("\n"),
            ),
          ],
          environment: {
            LIBRARY_SOURCE: firstSource,
            SCOPE_FILE: disappearingScope,
          },
        },
      }),
    "LIX_RESOLVER_UNSAFE_SCOPE",
  );
} finally {
  writeFileSync(disappearingScope, "# pinned first scope\n", "utf8");
}

rmSync(root, { force: true, recursive: true });
console.log(
  "lix-resolver: OK: ordered Lix resolution enters a complete safe HXML inventory",
);
