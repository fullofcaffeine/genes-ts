import {
  existsSync,
  lstatSync,
  readdirSync,
  watch,
  type FSWatcher,
} from "node:fs";
import path from "node:path";

import type {
  ReconciledWatchChange,
  ReconciledWatchOptions,
  ReconciliationResult,
  ReconciledWatchSession,
  TreeWatchInput,
  WatchInput,
} from "./types.js";

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_SNAPSHOT_ENTRIES = 100_000;

interface EntryBudget {
  readonly maxEntries: number;
  readonly label: string;
  entries: number;
}

interface WalkedTreeEntry {
  readonly absolute: string;
  readonly relative: string;
  readonly ignored: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
}

interface SnapshotEntry<Cause> {
  readonly fingerprint: string;
  readonly cause: Cause;
}

type Snapshot<Cause> = Map<string, SnapshotEntry<Cause>>;

function bytewise(values: Iterable<string>): string[] {
  return [...values].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function fingerprint(candidate: string): string {
  if (!existsSync(candidate)) {
    return "missing";
  }
  const stats = lstatSync(candidate, { bigint: true });
  const kind = stats.isFile()
    ? "file"
    : stats.isDirectory()
      ? "directory"
      : stats.isSymbolicLink()
        ? "symlink"
        : "special";
  return [
    kind,
    stats.dev,
    stats.ino,
    stats.mode,
    stats.size,
    stats.mtimeNs,
    stats.ctimeNs,
  ].join(":");
}

function within(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function assertNoSymlinkComponents(candidate: string): void {
  const absolute = path.resolve(candidate);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute
    .slice(parsed.root.length)
    .split(path.sep)
    .filter((value) => value.length > 0)) {
    current = path.join(current, segment);
    // `existsSync` also returns false for a symbolic link whose target is
    // missing. Inspect the path entry itself so that unsafe link is never
    // confused with a generated directory that simply does not exist yet.
    const status = lstatSync(current, { throwIfNoEntry: false });
    if (status === undefined) {
      return;
    }
    if (status.isSymbolicLink()) {
      throw new Error(`watch input traverses a symbolic link: ${current}`);
    }
  }
}

function entryBudget(maxEntries: number, label: string): EntryBudget {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new Error("invalid reconciled watch entry budget");
  }
  return { maxEntries, label, entries: 0 };
}

function consumeEntry(budget: EntryBudget): void {
  budget.entries += 1;
  if (budget.entries > budget.maxEntries) {
    throw new Error(`${budget.label} entry budget exceeded`);
  }
}

function* walkTree(
  root: string,
  ignore: TreeWatchInput<unknown>["ignore"],
  budget: EntryBudget,
): Generator<WalkedTreeEntry> {
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const nested: string[] = [];
    for (const child of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)),
    )) {
      consumeEntry(budget);
      const absolute = path.join(directory, child.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const ignored = ignore?.(relative) === true;
      yield {
        absolute,
        relative,
        ignored,
        isDirectory: child.isDirectory(),
        isSymbolicLink: child.isSymbolicLink(),
      };
      if (child.isDirectory() && !ignored) {
        nested.push(absolute);
      }
    }
    for (let index = nested.length - 1; index >= 0; index -= 1) {
      pending.push(nested[index]!);
    }
  }
}

/** @internal Shared bounded validation for compiler-readable input trees. */
export function assertRealInputTrees(
  inputs: readonly { readonly path: string; readonly label: string }[],
  maxEntries = DEFAULT_MAX_SNAPSHOT_ENTRIES,
): void {
  const budget = entryBudget(maxEntries, "watch input");
  for (const input of inputs) {
    consumeEntry(budget);
    if (!existsSync(input.path)) continue;
    const stats = lstatSync(input.path);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`${input.label} must be a real directory: ${input.path}`);
    }
    for (const entry of walkTree(input.path, undefined, budget)) {
      if (entry.isSymbolicLink) {
        throw new Error(
          `${input.label} contains a symbolic link: ${entry.absolute}`,
        );
      }
    }
  }
}

function validateInputs<Cause>(
  options: ReconciledWatchOptions<Cause>,
): readonly WatchInput<Cause>[] {
  if (
    options.inputs.length === 0 ||
    !Number.isInteger(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS) ||
    (options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS) < 10 ||
    !Number.isInteger(
      options.maxSnapshotEntries ?? DEFAULT_MAX_SNAPSHOT_ENTRIES,
    ) ||
    (options.maxSnapshotEntries ?? DEFAULT_MAX_SNAPSHOT_ENTRIES) <= 0
  ) {
    throw new Error("invalid reconciled watch options");
  }
  return Object.freeze(
    options.inputs.map((input, index) => {
      if (!path.isAbsolute(input.path)) {
        throw new Error(`watch input ${index} must be absolute`);
      }
      assertNoSymlinkComponents(input.path);
      return Object.freeze({ ...input, path: path.resolve(input.path) });
    }),
  );
}

function addEntry<Cause>(
  snapshot: Snapshot<Cause>,
  candidate: string,
  cause: Cause,
  entryFingerprint: string,
  merge: (left: Cause, right: Cause) => Cause,
  maxEntries: number,
): void {
  const absolute = path.resolve(candidate);
  const previous = snapshot.get(absolute);
  snapshot.set(
    absolute,
    Object.freeze({
      fingerprint: entryFingerprint,
      cause: previous === undefined ? cause : merge(previous.cause, cause),
    }),
  );
  if (snapshot.size > maxEntries) {
    throw new Error("watch snapshot entry budget exceeded");
  }
}

function scanTree<Cause>(
  snapshot: Snapshot<Cause>,
  input: TreeWatchInput<Cause>,
  merge: (left: Cause, right: Cause) => Cause,
  maxEntries: number,
  budget: EntryBudget,
): void {
  const root = input.path;
  consumeEntry(budget);
  if (!existsSync(root)) {
    addEntry(snapshot, root, input.cause, "missing-tree", merge, maxEntries);
    return;
  }
  const rootStats = lstatSync(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    addEntry(
      snapshot,
      root,
      input.cause,
      fingerprint(root),
      merge,
      maxEntries,
    );
    return;
  }
  addEntry(snapshot, root, input.cause, "directory", merge, maxEntries);
  for (const entry of walkTree(root, input.ignore, budget)) {
    if (entry.ignored) continue;
    if (entry.isSymbolicLink && input.rejectSymlinks === true) {
      throw new Error(
        `watched tree contains a symbolic link: ${entry.absolute}`,
      );
    }
    if (entry.isDirectory) {
      if (input.include(entry.relative)) {
        addEntry(
          snapshot,
          entry.absolute,
          input.cause,
          "directory",
          merge,
          maxEntries,
        );
      }
    } else if (input.include(entry.relative)) {
      addEntry(
        snapshot,
        entry.absolute,
        input.cause,
        fingerprint(entry.absolute),
        merge,
        maxEntries,
      );
    }
  }
}

function capture<Cause>(
  inputs: readonly WatchInput<Cause>[],
  merge: (left: Cause, right: Cause) => Cause,
  maxEntries: number,
): Snapshot<Cause> {
  const snapshot: Snapshot<Cause> = new Map();
  const budget = entryBudget(maxEntries, "watch input traversal");
  for (const input of inputs) {
    // A missing input can gain a symbolic-link parent after registration.
    // Check the live path before every scan so reconciliation never follows
    // that new link into a different tree.
    assertNoSymlinkComponents(input.path);
    if (input.kind === "exact") {
      consumeEntry(budget);
      addEntry(
        snapshot,
        input.path,
        input.cause,
        fingerprint(input.path),
        merge,
        maxEntries,
      );
    } else {
      scanTree(snapshot, input, merge, maxEntries, budget);
    }
  }
  return snapshot;
}

function changed<Cause>(
  previous: ReadonlyMap<string, SnapshotEntry<Cause>>,
  current: ReadonlyMap<string, SnapshotEntry<Cause>>,
  merge: (left: Cause, right: Cause) => Cause,
  origin: ReconciledWatchChange<Cause>["origin"],
): readonly ReconciledWatchChange<Cause>[] {
  return Object.freeze(
    bytewise(new Set([...previous.keys(), ...current.keys()])).flatMap(
      (candidate) => {
        const before = previous.get(candidate);
        const after = current.get(candidate);
        if (before?.fingerprint === after?.fingerprint) {
          return [];
        }
        const cause =
          before === undefined
            ? after!.cause
            : after === undefined
              ? before.cause
              : merge(before.cause, after.cause);
        return [Object.freeze({ path: candidate, cause, origin })];
      },
    ),
  );
}

function nearestRealDirectory(candidate: string): string {
  assertNoSymlinkComponents(candidate);
  let current = path.resolve(candidate);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`cannot find watchable parent for ${candidate}`);
    }
    current = parent;
  }
  const stats = lstatSync(current);
  if (stats.isSymbolicLink()) {
    throw new Error(`watch path traverses a symbolic link: ${current}`);
  }
  if (stats.isFile()) {
    return path.dirname(current);
  }
  if (!stats.isDirectory()) {
    throw new Error(`watch path has no real directory parent: ${candidate}`);
  }
  return current;
}

function collectTreeDirectories<Cause>(
  input: TreeWatchInput<Cause>,
  budget: EntryBudget,
): readonly string[] {
  assertNoSymlinkComponents(input.path);
  consumeEntry(budget);
  if (!existsSync(input.path)) {
    return Object.freeze([nearestRealDirectory(input.path)]);
  }
  const stats = lstatSync(input.path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    return Object.freeze([nearestRealDirectory(input.path)]);
  }
  const directories: string[] = [input.path];
  for (const entry of walkTree(input.path, input.ignore, budget)) {
    if (entry.isSymbolicLink && input.rejectSymlinks === true) {
      throw new Error(
        `watched tree contains a symbolic link: ${entry.absolute}`,
      );
    }
    if (entry.isDirectory && !entry.ignored) {
      directories.push(entry.absolute);
    }
  }
  return Object.freeze(directories);
}

function isRelevant<Cause>(
  inputs: readonly WatchInput<Cause>[],
  changedPath: string,
): boolean {
  for (const input of inputs) {
    let matches = false;
    if (input.kind === "exact") {
      matches =
        changedPath === input.path ||
        within(changedPath, input.path) ||
        within(input.path, changedPath);
    } else if (within(changedPath, input.path)) {
      const relative = path
        .relative(input.path, changedPath)
        .split(path.sep)
        .join("/");
      matches =
        input.ignore?.(relative) !== true &&
        (relative === "" || input.include(relative));
    }
    if (matches) {
      return true;
    }
  }
  return false;
}

export function watchReconciledInputs<Cause>(
  rawOptions: ReconciledWatchOptions<Cause>,
): ReconciledWatchSession {
  const inputs = validateInputs(rawOptions);
  const pollIntervalMs =
    rawOptions.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxEntries =
    rawOptions.maxSnapshotEntries ?? DEFAULT_MAX_SNAPSHOT_ENTRIES;
  const nativeEvents = rawOptions.nativeEvents ?? true;
  const watchers = new Map<string, FSWatcher>();
  let closed = false;
  let snapshot = capture(inputs, rawOptions.merge, maxEntries);
  let lastError: string | null = null;

  const reportError = (error: unknown): void => {
    const normalized = asError(error);
    if (normalized.message !== lastError) {
      lastError = normalized.message;
      rawOptions.onError(normalized);
    }
  };

  const desiredDirectories = (): readonly string[] => {
    const directories = new Set<string>();
    const budget = entryBudget(maxEntries, "watch directory traversal");
    for (const input of inputs) {
      if (input.kind === "exact") {
        consumeEntry(budget);
        directories.add(nearestRealDirectory(path.dirname(input.path)));
      } else {
        for (const directory of collectTreeDirectories(input, budget)) {
          directories.add(directory);
        }
      }
    }
    return Object.freeze(bytewise(directories));
  };

  const emitReconciliation = (
    origin: ReconciledWatchChange<Cause>["origin"],
  ): ReconciliationResult => {
    if (closed) {
      return Object.freeze({
        ok: false,
        error: new Error("reconciled watch is closed"),
      });
    }
    try {
      const current = capture(inputs, rawOptions.merge, maxEntries);
      const changes = changed(snapshot, current, rawOptions.merge, origin);
      snapshot = current;
      lastError = null;
      for (const change of changes) {
        rawOptions.onChange(change);
      }
      return Object.freeze({ ok: true, changed: changes.length > 0 });
    } catch (error) {
      const normalized = asError(error);
      reportError(normalized);
      return Object.freeze({ ok: false, error: normalized });
    }
  };

  const refreshNative = (): void => {
    if (!nativeEvents || closed) {
      return;
    }
    let desired: readonly string[];
    try {
      desired = desiredDirectories();
    } catch (error) {
      reportError(error);
      return;
    }
    const desiredSet = new Set(desired);
    for (const [directory, watcher] of watchers) {
      if (!desiredSet.has(directory)) {
        watcher.close();
        watchers.delete(directory);
      }
    }
    for (const directory of desired) {
      if (watchers.has(directory)) {
        continue;
      }
      try {
        const watcher = watch(
          directory,
          { encoding: "utf8", persistent: true, recursive: false },
          (_event, filename) => {
            if (closed) {
              return;
            }
            const decoded =
              filename === null
                ? null
                : filename;
            const candidate =
              decoded === null ? directory : path.resolve(directory, decoded);
            if (
              decoded === null ||
              isRelevant(inputs, candidate)
            ) {
              emitReconciliation("native");
              refreshNative();
            }
          },
        );
        watcher.on("error", (error) => {
          watcher.close();
          watchers.delete(directory);
          reportError(error);
        });
        watchers.set(directory, watcher);
      } catch (error) {
        reportError(error);
      }
    }
  };

  refreshNative();
  rawOptions.onRegistered?.();
  emitReconciliation("registration");
  refreshNative();
  const polling = setInterval(() => {
    emitReconciliation("poll");
    refreshNative();
  }, pollIntervalMs);

  return Object.freeze({
    reconcile(): ReconciliationResult {
      const result = emitReconciliation("poll");
      refreshNative();
      return result;
    },
    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(polling);
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      watchers.clear();
    },
  });
}
