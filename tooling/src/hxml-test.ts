import assert from "node:assert/strict";
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
        "--cwd nested",
        "'nested build.hxml'",
        "-L sample:1.2.3",
        "",
      ].join("\n"),
    );
    write(
      root,
      "nested/nested build.hxml",
      [
        "--cwd ..",
        "--class-path \"${SHARED}\"",
        "-r assets/data.json@data",
        "cycle.hxml",
        "",
      ].join("\n"),
    );
    write(root, "cycle.hxml", "build.hxml\n");
    const library = write(
      root,
      "libraries/sample.hxml",
      "--class-path ../src\n",
    );

    const inventory = await inventoryHxml({
      entryFiles: ["build.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
      environment: (name) => (name === "SHARED" ? "shared dir" : null),
      resolveLibrary: (request) => {
        assert.equal(request.name, "sample");
        assert.equal(request.version, "1.2.3");
        return [library];
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
        "cycle.hxml",
        path.join("libraries", "sample.hxml"),
        path.join("nested", "nested build.hxml"),
      ].sort(),
    );
    assert.deepEqual(
      inventory.classPaths.map((file) => path.relative(root, file)).sort(),
      ["shared dir", "src"].sort(),
    );
    assert.deepEqual(
      inventory.resourceInputs.map((file) => path.relative(root, file)),
      [path.join("assets", "data.json")],
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

    write(root, "missing-env.hxml", "-cp ${ABSENT}\n");
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["missing-env.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
        }),
      "missing-environment",
    );

    write(root, "bad-quote.hxml", "-cp 'unterminated\n");
    await expectFailure(
      () =>
        inventoryHxml({
          entryFiles: ["bad-quote.hxml"],
          workingDirectory: root,
          allowedRoots: [root],
        }),
      "invalid-syntax",
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
          resolveLibrary: () => [
            path.join(root, "linked-library-directory/library.hxml"),
          ],
        }),
      "unsafe-input",
    );
    const directLibraryInventory = await inventoryHxml({
      entryFiles: ["library-via-link.hxml"],
      workingDirectory: root,
      allowedRoots: [root],
      resolveLibrary: () => [realLibraryHxml],
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
          resolveLibrary: () => ["relative.hxml"],
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

    write(root, "forbidden-child.hxml", "-Dgenes.output=public.ts\n");
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
        return new Promise<readonly string[]>(() => undefined);
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
