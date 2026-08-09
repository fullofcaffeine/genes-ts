import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  HAXE_4_3_7_EARLY_INLINE_OPTIONS,
  HxmlInventoryError,
  inventoryHxml,
} from "./hxml/index.js";

function write(root: string, relative: string, content: string): string {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
  return absolute;
}

async function expectFailure(
  action: () => Promise<unknown>,
  kind: HxmlInventoryError["failure"]["kind"],
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.equal(error instanceof HxmlInventoryError, true);
    assert.equal((error as HxmlInventoryError).failure.kind, kind);
    return true;
  });
}

async function main(): Promise<void> {
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-hxml-")),
  );
  try {
    mkdirSync(path.join(root, "src"), { recursive: true });
    mkdirSync(path.join(root, "shared dir"), { recursive: true });
    write(root, "assets/data.json", "{}\n");
    write(
      root,
      "build.hxml",
      [
        "# comment",
        "-p src",
        "'nested/nested build.hxml'",
        "-L sample:1.2.3",
        "",
      ].join("\n"),
    );
    write(
      root,
      "nested/nested build.hxml",
      [
        "--class-path \"%SHARED%\"",
        "leaf.hxml",
        "",
      ].join("\n"),
    );
    write(root, "leaf.hxml", "");
    const library = write(
      root,
      "libraries/sample.hxml",
      `--class-path ${path.join(root, "src")}\n`,
    );

    const inventory = await inventoryHxml({
      entryFiles: ["build.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
      environment: (name) => (name === "SHARED" ? "shared dir" : null),
      resolveLibrary: (request) => {
        assert.equal(request.name, "sample");
        assert.equal(request.version, "1.2.3");
        return { arguments: [library], provenanceFiles: [library] };
      },
    });
    assert.deepEqual(
      inventory.entryHxmlFiles.map((file) => path.relative(root, file)),
      ["build.hxml"],
    );
    assert.deepEqual(
      inventory.hxmlFiles.map((file) => path.relative(root, file)),
      [
        "build.hxml",
        path.join("libraries", "sample.hxml"),
        "leaf.hxml",
        path.join("nested", "nested build.hxml"),
      ].sort(),
    );
    assert.deepEqual(
      inventory.classPaths.map((file) => path.relative(root, file)).sort(),
      ["shared dir", "src"].sort(),
    );
    assert.deepEqual(inventory.resourceInputs, []);
    assert.deepEqual(
      inventory.libraryProvenanceFiles.map((file) => path.relative(root, file)),
      [path.join("libraries", "sample.hxml")],
    );
    assert.deepEqual(
      inventory.libraries.map(({ request, name, version }) => ({
        request,
        name,
        version,
      })),
      [{ request: "sample:1.2.3", name: "sample", version: "1.2.3" }],
    );
    assert.equal(inventory.libraryClosureComplete, true);
    assert.deepEqual(inventory.effectiveArguments, [
      "-p",
      "src",
      "--class-path",
      "shared dir",
      "--class-path",
      path.join(root, "src"),
    ]);
    assert.equal(inventory.effectiveArguments.includes("-L"), false);
    assert.equal(inventory.effectiveArguments.includes("sample:1.2.3"), false);

    write(root, "carriage-return-lines.hxml", "-cp src\r-main Main\r");
    const carriageReturnInventory = await inventoryHxml({
      entryFiles: ["carriage-return-lines.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
    });
    assert.deepEqual(
      carriageReturnInventory.effectiveArguments,
      ["-cp", "src", "-main", "Main"],
    );

    write(root, "repeated.hxml", "--macro repeated()\n");
    const repeatedInventory = await inventoryHxml({
      entryFiles: ["repeated.hxml", "repeated.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
    });
    assert.deepEqual(
      repeatedInventory.effectiveArguments,
      ["--macro", "repeated()", "--macro", "repeated()"],
      "each acyclic HXML occurrence must keep its arguments",
    );
    assert.equal(repeatedInventory.hxmlOccurrences.length, 2);

    write(root, "cycle-a.hxml", "cycle-b.hxml\n");
    write(root, "cycle-b.hxml", "cycle-a.hxml\n");
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["cycle-a.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
        }),
      "invalid-syntax",
    );

    write(root, "environment-library.hxml", "-lib %LIBRARY%\n");
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["environment-library.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
          environment: (name) => (name === "LIBRARY" ? "sample" : null),
          resolveLibrary: () => ({ arguments: [], provenanceFiles: [] }),
        }),
      "invalid-syntax",
    );

    write(
      root,
      "equals-values.hxml",
      "--class-path=src\n--define=feature=enabled\n",
    );
    const equalsValueInventory = await inventoryHxml({
      entryFiles: ["equals-values.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
    });
    assert.deepEqual(equalsValueInventory.effectiveArguments, [
      "--class-path",
      "src",
      "--define",
      "feature=enabled",
    ]);

    write(
      root,
      "missing-class-path.hxml",
      "-cp generated-src\n-cp src\n-main MissingClassPathMain\n--interp\n",
    );
    write(
      root,
      "src/MissingClassPathMain.hx",
      "class MissingClassPathMain { static function main():Void {} }\n",
    );
    const missingClassPathInventory = await inventoryHxml({
      entryFiles: ["missing-class-path.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
    });
    assert.equal(
      missingClassPathInventory.classPaths.includes(
        path.join(root, "generated-src"),
      ),
      true,
      "a class path may be watched before its directory is created",
    );
    mkdirSync(path.join(root, "generated-src"));
    const missingClassPathNative = spawnSync(
      "haxe",
      missingClassPathInventory.effectiveArguments,
      { cwd: root, encoding: "utf8", timeout: 2_000 },
    );
    assert.equal(missingClassPathNative.error, undefined);
    assert.equal(
      missingClassPathNative.status,
      0,
      missingClassPathNative.stderr,
    );

    write(root, "option-payload.hxml", "Main\n--xml escaped.xml\n");
    write(root, "option-value-hxml.hxml", "--main option-payload.hxml\n");
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["option-value-hxml.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
        }),
      "invalid-syntax",
    );
    write(root, "inline-option-value-hxml.hxml", "--main=option-payload.hxml\n");
    const inlineOptionValueInventory = await inventoryHxml({
      entryFiles: ["inline-option-value-hxml.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
    });
    assert.deepEqual(inlineOptionValueInventory.effectiveArguments, [
      "--main=option-payload.hxml",
    ]);

    write(
      root,
      "inline-define-hxml-value.hxml",
      "--define=config=option-payload.hxml\n-cp src\n-main MissingClassPathMain\n--interp\n",
    );
    const inlineDefineInventory = await inventoryHxml({
      entryFiles: ["inline-define-hxml-value.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
    });
    assert.equal(
      inlineDefineInventory.effectiveArguments[0],
      "--define=config=option-payload.hxml",
      "the inline spelling must stay intact so Haxe does not reopen its value as HXML",
    );
    write(
      root,
      "inline-define-control.hxml",
      "--define=config=%INLINE_VALUE%\n",
    );
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["inline-define-control.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
          environment: (name) =>
            name === "INLINE_VALUE" ? "safe.hxml\n--cmd=unsafe" : null,
        }),
      "invalid-syntax",
    );

    for (const option of HAXE_4_3_7_EARLY_INLINE_OPTIONS) {
      let resolverCalls = 0;
      const fixtureName = option.replaceAll(/[^A-Za-z0-9]+/gu, "-");
      const fixture = `inline-early-option-${fixtureName}.hxml`;
      write(root, fixture, `${option}=fixture\n`);
      await expectFailure(
        () =>
          inventoryHxml({
            entryFiles: [fixture],
            workingDirectory: root,
            allowedRoots: [root],
            resolveLibrary: () => {
              resolverCalls += 1;
              return {
                arguments: ["--macro", "mustNotResolveInlineLibrary()"],
                provenanceFiles: [],
              };
            },
          }),
        "invalid-syntax",
      );
      assert.equal(
        resolverCalls,
        0,
        `${option}=fixture must fail before an external resolver runs`,
      );
    }

    const nativeInlineExit = new Map<string, number>([
      ["-C", 1],
      ["--cwd", 1],
      ["--connect", 1],
      ["--server-connect", 1],
      ["--server-listen", 1],
      ["--wait", 1],
      ["--run", 1],
      ["-L", 0],
      ["--library", 0],
      ["-lib", 0],
      ["--jvm", 0],
      ["--java", 0],
      ["-java", 0],
      ["--cs", 1],
      ["-cs", 1],
      ["--display", 1],
    ]);
    for (const option of HAXE_4_3_7_EARLY_INLINE_OPTIONS) {
      const native = spawnSync("haxe", [`${option}=fixture`], {
        cwd: root,
        encoding: "utf8",
        timeout: 2_000,
      });
      assert.equal(
        native.error,
        undefined,
        `Haxe 4.3.7 inline probe timed out for ${option}=fixture`,
      );
      assert.equal(
        native.status,
        nativeInlineExit.get(option),
        `the inventory table must be reviewed if Haxe changes ${option}=fixture`,
      );
    }

    write(root, "library-hxml-value.hxml", "-lib hxml-value\n");
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["library-hxml-value.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
          resolveLibrary: () => ({
            arguments: ["--main", "option-payload.hxml"],
            provenanceFiles: [],
          }),
        }),
      "invalid-syntax",
    );

    write(root, "repeated-library.hxml", "-lib repeated\n-lib repeated\n");
    const repeatedLibraryInventory = await inventoryHxml({
      entryFiles: ["repeated-library.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
      resolveLibrary: () => ({
        arguments: ["--macro", "fromLibrary()"],
        provenanceFiles: [],
      }),
    });
    assert.deepEqual(repeatedLibraryInventory.effectiveArguments, [
      "--macro",
      "fromLibrary()",
    ]);
    assert.equal(
      repeatedLibraryInventory.libraries.length,
      1,
      "Haxe resolves one library identity once even when HXML repeats it",
    );

    write(
      root,
      "multiple-distinct-libraries.hxml",
      "-lib first\n-lib second\n",
    );
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["multiple-distinct-libraries.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
          resolveLibrary: () => ({ arguments: [], provenanceFiles: [] }),
        }),
      "invalid-syntax",
    );

    write(root, "dotted-library.hxml", "-lib sample.hxml\n");
    const dottedLibraryInventory = await inventoryHxml({
      entryFiles: ["dotted-library.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
      resolveLibrary: (request) => {
        assert.equal(request.name, "sample.hxml");
        return {
          arguments: ["--macro", "fromDottedLibrary()"],
          provenanceFiles: [],
        };
      },
    });
    assert.deepEqual(dottedLibraryInventory.effectiveArguments, [
      "--macro",
      "fromDottedLibrary()",
    ]);
    const unresolvedDottedLibraryInventory = await inventoryHxml({
      entryFiles: ["dotted-library.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
    });
    assert.equal(unresolvedDottedLibraryInventory.libraryClosureComplete, false);
    assert.deepEqual(unresolvedDottedLibraryInventory.effectiveArguments, [
      "-lib",
      "sample.hxml",
    ]);
    write(root, "inline-dotted-library.hxml", "--library=sample.hxml\n");
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["inline-dotted-library.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
        }),
      "invalid-syntax",
    );

    mkdirSync(path.join(root, "a", "src"), { recursive: true });
    mkdirSync(path.join(root, "b", "src"), { recursive: true });
    write(root, "shared-context.hxml", "-cp src\n");
    write(
      root,
      "contextual.hxml",
      [
        "-C a",
        "../shared-context.hxml",
        "-C ../b",
        "../shared-context.hxml",
        "",
      ].join("\n"),
    );
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["contextual.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
        }),
      "invalid-option",
    );

    const orderedFirst = write(root, "ordered-first.hxml", "");
    const orderedSecond = write(root, "ordered-second.hxml", "");
    const orderedInventory = await inventoryHxml({
      entryFiles: ["ordered-second.hxml", "ordered-first.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
    });
    assert.deepEqual(orderedInventory.entryHxmlFiles, [
      realpathSync.native(orderedSecond),
      realpathSync.native(orderedFirst),
    ]);

    write(root, "missing-env.hxml", "-cp %ABSENT%\n");
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["missing-env.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
        }),
      "missing-input",
    );

    write(root, "outside.hxml", "../outside.hxml\n");
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["outside.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
        }),
      "unsafe-input",
    );

    write(root, "library-via-link.hxml", "-lib linked-library\n");
    mkdirSync(path.join(root, "real-library-directory"));
    const realLibraryHxml = write(
      root,
      "real-library-directory/library.hxml",
      "",
    );
    symlinkSync(
      "real-library-directory",
      path.join(root, "linked-library-directory"),
    );
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["library-via-link.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
          resolveLibrary: () => ({
            arguments: [],
            provenanceFiles: [
              path.join(root, "linked-library-directory/library.hxml"),
            ],
          }),
        }),
      "unsafe-input",
    );
    const directLibraryInventory = await inventoryHxml({
      entryFiles: ["library-via-link.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
      resolveLibrary: () => ({
        arguments: [realLibraryHxml],
        provenanceFiles: [realLibraryHxml],
      }),
    });
    assert.equal(
      directLibraryInventory.hxmlFiles.includes(
        realpathSync.native(realLibraryHxml),
      ),
      true,
    );

    write(root, "real.hxml", "");
    symlinkSync("real.hxml", path.join(root, "linked.hxml"));
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["linked.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
        }),
      "unsafe-input",
    );

    mkdirSync(path.join(root, "real-entry-directory"));
    write(root, "real-entry-directory/build.hxml", "");
    symlinkSync(
      "real-entry-directory",
      path.join(root, "linked-entry-directory"),
    );
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["linked-entry-directory/build.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
        }),
      "unsafe-input",
    );

    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["build.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
          maxHxmlFiles: 1,
        }),
      "budget-exceeded",
    );

    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["missing.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
        }),
      "missing-input",
    );

    write(root, "missing-option.hxml", "--class-path\n");
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["missing-option.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
        }),
      "invalid-syntax",
    );

    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["build.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
          maxArguments: 1,
        }),
      "budget-exceeded",
    );

    write(root, "relative-library.hxml", "-lib sample\n");
    const requestOnlyInventory = await inventoryHxml({
      entryFiles: ["relative-library.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
    });
    assert.equal(requestOnlyInventory.libraryClosureComplete, false);
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["relative-library.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
          resolveLibrary: () => ({
            arguments: [],
            provenanceFiles: ["relative.hxml"],
          }),
        }),
      "resolver-failure",
    );
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["relative-library.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
          resolveLibrary: () => {
            throw new Error("resolver failed");
          },
        }),
      "resolver-failure",
    );

    write(root, "forbidden-child.hxml", "-D genes.output=public.ts\n");
    write(root, "forbidden-parent.hxml", "forbidden-child.hxml\n");
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["forbidden-parent.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
          argumentPolicy: { forbiddenDefines: ["genes.output"] },
        }),
      "invalid-option",
    );

    write(root, "forbidden-next.hxml", "--next\n");
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["forbidden-next.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
          argumentPolicy: { forbiddenOptions: ["--next"] },
        }),
      "invalid-option",
    );

    write(root, "abort-library.hxml", "-lib waiting\n");
    const abort = new AbortController();
    let resolverSignal: AbortSignal | null = null;
    const pending = inventoryHxml({
      entryFiles: ["abort-library.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
      signal: abort.signal,
      resolveLibrary: (_request, context) => {
        resolverSignal = context?.signal ?? null;
        return new Promise<never>(() => undefined);
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    abort.abort();
    await expectFailure(() => pending, "resolver-failure");
    assert.equal((resolverSignal as unknown as AbortSignal).aborted, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log("genes tooling HXML inventory: ok");
}

await main();
