import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const { NullableRecordProbe: probe } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const record = { values: ["kept"] };
assert.equal(probe.identity(record), record);
assert.equal(probe.forward({ review: record }), 1);
assert.equal(probe.throughLocal({ review: record }), 1);
assert.equal(probe.accept(), 0);
assert.equal(probe.accept(null), 0);
assert.equal(Object.hasOwn(record, "fingerprint"), false);
assert.deepEqual(record, { values: ["kept"] });
