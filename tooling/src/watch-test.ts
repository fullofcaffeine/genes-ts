import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  watchReconciledInputs,
  type ReconciledWatchChange,
} from "./watch/index.js";

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail("watch change did not arrive before the test deadline");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

async function main(): Promise<void> {
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), "genes-watch-")),
  );
  try {
    mkdirSync(path.join(root, "src"), { recursive: true });
    const exact = path.join(root, "build.hxml");
    const source = path.join(root, "src", "Main.hx");
    writeFileSync(exact, "-cp src\n", "utf8");
    writeFileSync(source, "class Main {}\n", "utf8");

    const polled: Array<ReconciledWatchChange<readonly string[]>> = [];
    const errors: string[] = [];
    const polling = watchReconciledInputs<readonly string[]>({
      inputs: [
        { kind: "exact", path: exact, cause: ["identity"] },
        {
          kind: "tree",
          path: path.join(root, "src"),
          cause: ["source"],
          include: (relative) => relative.endsWith(".hx"),
          ignore: (relative) => relative.startsWith("ignored/"),
        },
      ],
      merge: (left, right) =>
        Object.freeze([...new Set([...left, ...right])].sort()),
      onChange: (change) => polled.push(change),
      onError: (error) => errors.push(error.message),
      nativeEvents: false,
      pollIntervalMs: 20,
    });
    writeFileSync(source, "class Main { static final changed = true; }\n", "utf8");
    await waitUntil(() => polled.length > 0);
    assert.equal(polled.some((change) => change.path === source), true);
    assert.equal(polled.every((change) => change.origin === "poll"), true);

    const created = path.join(root, "src", "Created.hx");
    writeFileSync(created, "class Created {}\n", "utf8");
    await waitUntil(() => polled.some((change) => change.path === created));
    unlinkSync(created);
    const createdChanges = polled.filter(
      (change) => change.path === created,
    ).length;
    await waitUntil(
      () =>
        polled.filter((change) => change.path === created).length >
        createdChanges,
    );

    writeFileSync(path.join(root, "src", "ignored.txt"), "ignored\n", "utf8");
    const beforeFiltered = polled.length;
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    assert.equal(polled.length, beforeFiltered);

    mkdirSync(path.join(root, "src", "ignored"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "ignored", "Ignored.hx"),
      "class Ignored {}\n",
      "utf8",
    );
    const beforeIgnored = polled.length;
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    assert.equal(polled.length, beforeIgnored);
    polling.close();

    const registered: Array<ReconciledWatchChange<string>> = [];
    const registration = watchReconciledInputs({
      inputs: [{ kind: "exact", path: exact, cause: "identity" }],
      merge: (left) => left,
      onChange: (change) => registered.push(change),
      onError: (error) => errors.push(error.message),
      nativeEvents: false,
      pollIntervalMs: 1_000,
      onRegistered: () =>
        writeFileSync(exact, "-cp src\n-D registration\n", "utf8"),
    });
    assert.deepEqual(
      registered.map(({ path: changedPath, cause, origin }) => ({
        path: changedPath,
        cause,
        origin,
      })),
      [{ path: exact, cause: "identity", origin: "registration" }],
    );
    registration.close();

    const missingChanges: Array<ReconciledWatchChange<string>> = [];
    const missingRoot = path.join(root, "later");
    const missingSession = watchReconciledInputs({
      inputs: [
        {
          kind: "tree",
          path: missingRoot,
          cause: "source",
          include: (relative) => relative.endsWith(".hx"),
        },
      ],
      merge: (left) => left,
      onChange: (change) => missingChanges.push(change),
      onError: (error) => errors.push(error.message),
      nativeEvents: false,
      pollIntervalMs: 20,
    });
    mkdirSync(missingRoot);
    const later = path.join(missingRoot, "Later.hx");
    writeFileSync(later, "class Later {}\n", "utf8");
    await waitUntil(() =>
      missingChanges.some((change) => change.path === later),
    );
    missingSession.close();

    assert.throws(
      () =>
        watchReconciledInputs({
          inputs: [
            {
              kind: "tree",
              path: path.join(root, "src"),
              cause: "source",
              include: (relative) => relative.endsWith(".hx"),
            },
          ],
          merge: (left) => left,
          onChange: () => {},
          onError: () => {},
          maxSnapshotEntries: 1,
        }),
      /budget/u,
    );

    const native: Array<ReconciledWatchChange<string>> = [];
    const nativeSession = watchReconciledInputs({
      inputs: [{ kind: "exact", path: exact, cause: "identity" }],
      merge: (left) => left,
      onChange: (change) => native.push(change),
      onError: (error) => errors.push(error.message),
      pollIntervalMs: 1_000,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    writeFileSync(exact, "-cp src\n-D native\n", "utf8");
    await waitUntil(() => native.length > 0);
    assert.equal(native[0]!.path, exact);
    assert.equal(native[0]!.origin, "native");
    nativeSession.close();

    symlinkSync("src", path.join(root, "linked-src"));
    assert.throws(
      () =>
        watchReconciledInputs({
          inputs: [
            {
              kind: "tree",
              path: path.join(root, "linked-src"),
              cause: "source",
              include: () => true,
            },
          ],
          merge: (left) => left,
          onChange: () => {},
          onError: () => {},
        }),
      /symbolic link/u,
    );
    assert.deepEqual(errors, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log("genes tooling reconciled watch: ok");
}

await main();
