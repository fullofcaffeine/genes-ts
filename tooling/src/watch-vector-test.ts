import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

interface Vector {
  readonly id: string;
  readonly family: "hxml" | "watch" | "loop";
  readonly covers: readonly string[];
  readonly description: string;
  readonly expected: "success" | "failure";
}

interface Corpus {
  readonly protocol: "genes.tooling.watch-orchestration-vectors";
  readonly version: 1;
  readonly vectors: readonly Vector[];
}

const corpus = JSON.parse(
  readFileSync(
    new URL("../watch-orchestration/v1/vectors.json", import.meta.url),
    "utf8",
  ),
) as Corpus;
assert.deepEqual(
  Object.keys(corpus).sort(),
  ["protocol", "vectors", "version"],
);
assert.equal(corpus.protocol, "genes.tooling.watch-orchestration-vectors");
assert.equal(corpus.version, 1);
assert.equal(Array.isArray(corpus.vectors), true);
for (const vector of corpus.vectors) {
  assert.deepEqual(
    Object.keys(vector).sort(),
    ["covers", "description", "expected", "family", "id"],
  );
  assert.match(vector.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  assert.equal(["hxml", "watch", "loop"].includes(vector.family), true);
  assert.equal(vector.covers.length > 0, true);
  assert.equal(new Set(vector.covers).size, vector.covers.length);
  for (const coverage of vector.covers) {
    assert.match(coverage, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  }
  assert.equal(vector.description.length > 0, true);
  assert.equal(["success", "failure"].includes(vector.expected), true);
}

const ids = corpus.vectors.map((vector) => vector.id);
assert.equal(new Set(ids).size, ids.length, "vector IDs must be unique");
const sortedIds = [...ids].sort((left, right) =>
  Buffer.from(left).compare(Buffer.from(right)),
);
const runtimeIds = [
  "hxml-budget",
  "hxml-classpath-resource",
  "hxml-environment",
  "hxml-invalid-syntax",
  "hxml-library",
  "hxml-missing-environment",
  "hxml-missing-input",
  "hxml-nested-cwd-cycle",
  "hxml-path-escape",
  "hxml-quotes-escapes-comments",
  "hxml-resolver-failure",
  "hxml-symlink",
  "loop-burst-merge",
  "loop-close-pending",
  "loop-dirty-during-run",
  "loop-error-recovery",
  "loop-invalid-debounce",
  "loop-wait-after-close",
  "watch-filter-ignore",
  "watch-missing-tree",
  "watch-native-exact",
  "watch-poll-exact",
  "watch-poll-tree-create-remove",
  "watch-registration-gap",
  "watch-snapshot-budget",
  "watch-symlink-input",
].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
assert.deepEqual(
  sortedIds,
  runtimeIds,
  "every released vector must have a focused runtime control",
);

const covers = new Set(corpus.vectors.flatMap((vector) => vector.covers));
for (const required of [
  "argument-budget",
  "caller-merge",
  "closed-wait",
  "cycle",
  "dirty-during-run",
  "environment-expansion",
  "ignored-root",
  "library-resolver",
  "missing-root",
  "native-event",
  "newest-state-follow-up",
  "path-escape",
  "polling-only",
  "registration-gap",
  "snapshot-budget",
  "symlink-traversal",
]) {
  assert.equal(covers.has(required), true, `missing coverage: ${required}`);
}

const encoded = JSON.stringify(corpus);
for (const forbidden of [
  "nextjs",
  "next.js",
  "wordpress",
  "gutenberg",
  "app router",
  "plugin",
  "last-good",
]) {
  assert.equal(
    encoded.toLowerCase().includes(forbidden),
    false,
    `framework vocabulary leaked into shared vectors: ${forbidden}`,
  );
}

console.log(
  `genes tooling watch orchestration vectors: ${corpus.vectors.length} covered`,
);
