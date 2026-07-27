import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

interface Vector {
  readonly id: string;
  readonly covers: readonly string[];
  readonly description: string;
  readonly expected: "connected" | "direct" | "failure";
}

interface Corpus {
  readonly protocol: "genes.tooling.haxe-wait-server-vectors";
  readonly version: 1;
  readonly vectors: readonly Vector[];
}

const corpus = JSON.parse(
  readFileSync(
    new URL("../haxe-wait-server/v1/vectors.json", import.meta.url),
    "utf8",
  ),
) as Corpus;
assert.deepEqual(Object.keys(corpus).sort(), ["protocol", "vectors", "version"]);
assert.equal(corpus.protocol, "genes.tooling.haxe-wait-server-vectors");
assert.equal(corpus.version, 1);

for (const vector of corpus.vectors) {
  assert.deepEqual(
    Object.keys(vector).sort(),
    ["covers", "description", "expected", "id"],
  );
  assert.match(vector.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  assert.equal(vector.covers.length > 0, true);
  assert.equal(new Set(vector.covers).size, vector.covers.length);
  for (const coverage of vector.covers) {
    assert.match(coverage, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  }
  assert.equal(vector.description.length > 0, true);
  assert.equal(
    ["connected", "direct", "failure"].includes(vector.expected),
    true,
  );
}

const ids = corpus.vectors.map((vector) => vector.id);
assert.equal(new Set(ids).size, ids.length);
assert.deepEqual(
  [...ids].sort(),
  [
    "bounded-shutdown",
    "closed-idempotent",
    "compatible-reuse",
    "concurrent-ensure-serialization",
    "connected-compile-error-live-server",
    "direct-fallback-cache",
    "exact-byte-cleanup",
    "incompatible-restart",
    "lease-write-collision",
    "live-foreign-lease",
    "malformed-lease",
    "path-escape",
    "port-reservation-failure",
    "readiness-timeout",
    "stale-exact-lease",
    "startup-exit",
    "unexpected-exit-restart",
    "unresponsive-connected-fallback",
  ],
);

const covers = new Set(corpus.vectors.flatMap((vector) => vector.covers));
for (const required of [
  "bounded-close",
  "compatibility-digest",
  "direct-fallback",
  "exact-bytes",
  "foreign-lease",
  "lease-cleanup",
  "loopback-reservation",
  "owned-process",
  "process-liveness",
  "readiness-bound",
  "serialized-lifecycle",
  "sigkill",
  "sigterm",
  "stale-lease",
  "unexpected-exit",
]) {
  assert.equal(covers.has(required), true, `missing coverage: ${required}`);
}

const encoded = JSON.stringify(corpus).toLowerCase();
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
    encoded.includes(forbidden),
    false,
    `framework vocabulary leaked into shared vectors: ${forbidden}`,
  );
}

console.log(
  `genes tooling Haxe wait-server vectors: ${corpus.vectors.length} covered`,
);
